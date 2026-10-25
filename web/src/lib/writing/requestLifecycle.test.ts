import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const candidates = vi.hoisted(() => ({ values: [] as { commands: string[]; commit: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }[] }));
vi.mock('../mathPreamble', () => ({ prepareMathProfile: vi.fn(async () => ({})) }));
vi.mock('../mathjax', () => ({ validateMathProfile: vi.fn(async () => {
  const candidate = { commands: [], commit: vi.fn(), dispose: vi.fn() };
  candidates.values.push(candidate);
  return candidate;
}) }));
vi.mock('./format', () => ({ compileFormattingSettings: vi.fn() }));
vi.mock('./latex/snippets/parse', () => ({
  parseSnippets: vi.fn(async () => []),
  parseSnippetVariables: vi.fn(async () => ({})),
}));

const initialSettings = () => ({
  version: 1, migration: '', latex: { loadSnippetsFromFile: false, snippets: '[]', snippetVariables: '{}' },
  linter: {}, hotkeys: {},
});
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

beforeEach(() => { vi.resetModules(); candidates.values.length = 0; });
afterEach(() => { vi.unstubAllGlobals(); });

async function setup() {
  const fetcher = vi.fn()
    .mockResolvedValueOnce(json({ vault: 'isolated-writing-test-vault' }))
    .mockResolvedValueOnce(json(initialSettings()));
  vi.stubGlobal('fetch', fetcher);
  const api = await import('../api');
  await api.vaultRequestIdentity();
  fetcher.mockClear();
  const writing = await import('./config');
  await writing.refreshWriting();
  return { fetcher, api, writing };
}

describe('Writing uses the shared request lifecycle', () => {
  it('tracks an in-flight PUT until persistence acknowledges the prepared candidate', async () => {
    const { fetcher, api, writing } = await setup();
    let respond!: (response: Response) => void;
    let started!: () => void;
    const requestStarted = new Promise<void>(resolve => { started = resolve; });
    fetcher.mockImplementationOnce(() => {
      started();
      return new Promise<Response>(resolve => { respond = resolve; });
    });
    const counts: number[] = [];
    const stop = api.subscribeMutations(() => counts.push(api.pendingMutations()));
    const saved = writing.updateWriting({ latex: { mathPreviewEnabled: false } });
    await requestStarted;
    expect(api.pendingMutations()).toBe(1);
    expect(candidates.values[1].commit).not.toHaveBeenCalled();
    expect(writing.writingSettings().latex.mathPreviewEnabled).toBeUndefined();
    const persisted = { ...initialSettings(), latex: { ...initialSettings().latex, mathPreviewEnabled: false } };
    respond(json(persisted));
    await saved;
    stop();
    expect(counts).toEqual([1, 0]);
    expect(candidates.values[1].commit).toHaveBeenCalledOnce();
    expect(writing.writingSettings()).toEqual(persisted);
    const [url, options] = fetcher.mock.calls[1];
    expect(url).toBe('/api/writing');
    expect(options).toMatchObject({ method: 'PUT', credentials: 'include' });
    expect(JSON.parse(options.body)).toEqual({ latex: { mathPreviewEnabled: false } });
  });

  it('preserves ApiError for a non-JSON failure and releases the shared mutation count', async () => {
    const { fetcher, api, writing } = await setup();
    const previous = writing.writingSettings();
    fetcher.mockResolvedValueOnce(new Response('proxy failed', { status: 502, statusText: 'Bad Gateway' }));
    const saved = writing.updateWriting({ latex: { mathPreviewEnabled: false } });
    await expect(saved).rejects.toBeInstanceOf(api.ApiError);
    await expect(saved).rejects.toMatchObject({ status: 502, message: 'Bad Gateway' });
    expect(api.pendingMutations()).toBe(0);
    expect(writing.writingSettings()).toBe(previous);
    expect(candidates.values[1].dispose).toHaveBeenCalledOnce();
    expect(candidates.values[1].commit).not.toHaveBeenCalled();
  });

  it('rejects stale Vault writes before fetch and never commits their candidate', async () => {
    const { fetcher, api, writing } = await setup();
    api.invalidateVaultRequests();
    await expect(writing.updateWriting({ latex: { mathPreviewEnabled: false } })).rejects.toMatchObject({ status: 409 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(api.pendingMutations()).toBe(0);
    expect(candidates.values[1].dispose).toHaveBeenCalledOnce();
    expect(candidates.values[1].commit).not.toHaveBeenCalled();
  });

  it('keeps the preflight compilation gate before persistence', async () => {
    const { fetcher, writing } = await setup();
    const previous = writing.writingCMSettings();
    await expect(writing.updateWriting({ latex: { textMacros: 'invalid json' } })).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(writing.writingCMSettings()).toBe(previous);
    expect(candidates.values[1].dispose).toHaveBeenCalledOnce();
  });

  it('continues serialized writes after failure and applies only the successful response', async () => {
    const { fetcher, api, writing } = await setup();
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'busy' }), { status: 409 }));
    const persisted = { ...initialSettings(), latex: { ...initialSettings().latex, mathPreviewEnabled: true } };
    fetcher.mockResolvedValueOnce(json(persisted));
    const failed = writing.updateWriting({ latex: { mathPreviewEnabled: false } });
    const successful = writing.updateWriting({ latex: { mathPreviewEnabled: true } });
    await expect(failed).rejects.toMatchObject({ status: 409 });
    await successful;
    expect(fetcher.mock.calls.slice(1).map(([, options]) => JSON.parse(options.body).latex.mathPreviewEnabled)).toEqual([false, true]);
    expect(writing.writingSettings()).toEqual(persisted);
    expect(api.pendingMutations()).toBe(0);
    expect(candidates.values[1].commit).not.toHaveBeenCalled();
    expect(candidates.values[2].commit).toHaveBeenCalledOnce();
  });
});
