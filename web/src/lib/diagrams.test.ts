import { describe, expect, it } from 'vitest';
import { diagramRenderer } from './diagrams';

describe('shared Pele renderer', () => {
  it.each(['flowchart LR\nA[正文] --> B[目标]', 'sequenceDiagram\nAlice->>Bob: Hello', 'pie\n"A": 4\n"B": 2'])('renders existing diagram source with Pele: %s', async source => {
    const result = await diagramRenderer.render('fixture', source);
    expect(result.svg).toContain('class="pele ');
    expect(result.width).toBeGreaterThan(0);
  });
  it('rejects invalid input and subsequently renders valid input', async () => {
    await expect(diagramRenderer.render('invalid', 'not a diagram')).rejects.toThrow();
    expect((await diagramRenderer.render('valid', 'flowchart LR\nA-->B')).svg).toContain('pele-flowchart');
  });
  it('does not render after cancellation', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(diagramRenderer.render('cancelled', 'flowchart LR\nA-->B', undefined, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('disables untrusted diagram links and external images', async () => {
    const result = await diagramRenderer.render('safe', 'flowchart LR\nA[Click]\nclick A "javascript:alert(1)"');
    expect(result.svg).not.toContain('javascript:');
    expect(result.svg).not.toContain('<a ');
  });
});
