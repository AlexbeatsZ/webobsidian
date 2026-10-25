import React from 'react';
import { createRoot } from 'react-dom/client';
import { DocumentSession } from '@webobsidian/markdown-core';
import type { EditorView } from '@codemirror/view';
import MarkdownView from '../../web/src/components/MarkdownView';
import { blockLayout } from '../../web/src/lib/blockLayout';
import { syntaxModel, blockModel } from '../../web/src/lib/syntaxModel';
import { renderContext, type RenderContext } from '../../web/src/lib/renderContext';
import { frontmatterField } from '../../web/src/lib/livePreview';

export async function verifyContextReconfiguration() {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host), fragmentHost = document.createElement('div'); document.body.append(fragmentHost);
  const session = new DocumentSession('performance.md', '---\nkey: value\n---\n\n> [!note] Example\n> content\n\nend', undefined, async () => ({}));
  let editor: EditorView | null = null, currentProperties = 0;
  const context: RenderContext = { sourcePath: session.id, openLink: () => {}, openMenu: () => {},
    rawUrl: target => target, files: () => [], tags: async () => [], properties: async () => [],
    propertyTypes: () => ({}), setPropertyType: async () => ({}), renderEmbed: async () => null };
  const tick = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  const render = async (next: RenderContext) => {
    root.render(<MarkdownView snapshot={session.snapshot} mode="reading" context={next} showTitle={false}
      onReady={view => { editor = view; }} />);
    await tick();
  };
  let stop: (() => void) | undefined;
  try {
    await render(context);
    const initial = editor!.state, mount = initial.facet(renderContext).mountFragment!;
    await render({ ...context });
    const equivalent = editor!.state;
    const result = { layoutRetained: equivalent.field(blockLayout) === initial.field(blockLayout),
      syntaxRetained: equivalent.field(syntaxModel) === initial.field(syntaxModel),
      blocksRetained: equivalent.field(blockModel) === initial.field(blockModel),
      mountRetained: equivalent.facet(renderContext).mountFragment === mount,
      changedServicesInvalidate: false, fallbackUsesLatestContext: false };
    await render({ ...context, propertyTypes: () => { currentProperties++; return {}; } });
    result.changedServicesInvalidate = editor!.state.field(frontmatterField) !== equivalent.field(frontmatterField);
    currentProperties = 0;
    await new Promise<void>(resolve => {
      stop = mount(fragmentHost, '---\nkey: value\n---\n\nbody', { id: 'fragment.md', mode: 'reading', onReady: resolve });
    });
    result.fallbackUsesLatestContext = currentProperties > 0;
    return result;
  } finally {
    stop?.(); root.unmount(); await tick(); host.remove(); fragmentHost.remove();
  }
}
