import { describe, expect, it } from 'vitest';
import { analyzeMarkdown, extractMetadata, footnotes, footnoteFragment, footnoteReferenceFragment, fragmentRange, SourceDocument } from './index.js';

describe('shared footnote and navigation targets', () => {
  it('retains multiline Markdown children and every reference without rewriting source', () => {
    const raw = '\ufeff正文[^名] 再次[^名]\r\n\r\n[^名]: **第一段**\r\n    下一行\r\n\r\n    - 列表 $x$\r\n\r\n其他';
    const source = new SourceDocument(raw), model = analyzeMarkdown(source.text);
    const context = footnotes(model), note = context.notes[0];
    expect(footnotes(model)).toBe(context);
    expect(note).toMatchObject({ id: '名', number: 1, status: 'resolved', references: [{ from: 2, to: 6 }, { from: 9, to: 13 }] });
    expect(model.text.slice(note.definitions[0].bodyFrom, note.definitions[0].to)).toContain('- 列表 $x$');
    expect(model.nodes.some(node => node.name === 'BulletList')).toBe(true);
    expect(fragmentRange(model, footnoteFragment(note))).toMatchObject({ kind: 'footnote', from: source.text.indexOf('[^名]:'), to: source.text.indexOf('\n\n其他') });
    expect(fragmentRange(model, footnoteReferenceFragment(note, 1))).toMatchObject({ kind: 'reference', ...note.references[1] });
    expect(source.raw).toBe(raw);
  });
  it('excludes literal/comment/math markers and preserves inline Markdown content', () => {
    const model = analyzeMarkdown('`[^code]` \\[^escaped] $[^math]$ %%[^comment]%% ^[说明 **粗体** 与 $x$] [^missing]\n\n[^dup]: one\n\n[^dup]: two\n\n[^dup]');
    const notes = footnotes(model).notes;
    expect(notes.map(note => note.status)).toEqual(['resolved', 'missing', 'ambiguous']);
    expect(notes[0]).toMatchObject({ inline: true, number: 1 });
    const range = fragmentRange(model, footnoteFragment(notes[0]))!;
    expect(model.text.slice(range.from, range.to)).toBe('说明 **粗体** 与 $x$');
    expect(fragmentRange(model, '[^missing]')).toBeNull();
    expect(fragmentRange(model, '[^dup]')).toBeNull();
  });
  it('keeps quoted definitions in the existing quote container', () => {
    const model = analyzeMarkdown('> 正文[^q]\n>\n> [^q]: first\n>     second\n>\n>     - child\n\nend');
    const note = footnotes(model).notes[0];
    expect(note.status).toBe('resolved');
    expect(model.text.slice(note.definitions[0].from, note.definitions[0].to)).toBe('[^q]: first\n>     second\n>\n>     - child');
    expect(model.nodes.some(node => node.name === 'ListItem')).toBe(true);
  });
  it('distinguishes the section preview from its heading landing mark and resolves parent chains', () => {
    const model = analyzeMarkdown('# A\n\n## **目标**\n\nfirst\n\n# B\n\n## 目标\n\nsecond');
    const range = fragmentRange(model, 'B#%E7%9B%AE%E6%A0%87')!;
    expect(model.text.slice(range.from, range.to)).toContain('second');
    expect(model.text.slice(range.focus.from, range.focus.to)).toBe('## 目标');
    expect(fragmentRange(model, 'A#目标')!.from).toBe(model.text.indexOf('## **目标**'));
  });
  it('extracts shared link occurrences from grammar including references and nested URLs', () => {
    const text = '[[Note#标题|别名]] [nested](dir/a(b).md#H) [ref][id] [id][] `[[no]]` \\[[escaped]]\n\n[id]: Note.md#H';
    const meta = extractMetadata(analyzeMarkdown(text));
    expect(meta.linkOccurrences.map(link => [link.label, link.target])).toEqual([
      ['别名', 'Note#标题'], ['nested', 'dir/a(b).md#H'], ['ref', 'Note.md#H'], ['id', 'Note.md#H'],
    ]);
    expect(meta.linkDefinitions).toHaveLength(1);
    for (const link of meta.linkOccurrences) expect(text.slice(link.from, link.to)).toMatch(/\[/);
  });
  it('decodes Markdown destination escapes and keeps literal hash headings addressable', () => {
    const model = analyzeMarkdown('# C# compiler\n\n[nested](file\\(x\\).md#C%23%20compiler) [entity](Note&amp;Other.md)\n\n[[bad[[nested]]');
    expect(extractMetadata(model).linkOccurrences.map(link => link.target)).toEqual(['file(x).md#C%23%20compiler', 'Note&Other.md']);
    expect(fragmentRange(model, 'C%23%20compiler')?.focus.from).toBe(0);
  });
  it('does not absorb an adjacent ordinary link definition into a footnote paragraph', () => {
    const model = analyzeMarkdown('foot[^n] and [link][id]\n\n[^n]: note body\n[id]: Note.md#Heading\n\nend');
    const note = footnotes(model).notes[0];
    expect(model.text.slice(note.definitions[0].from, note.definitions[0].to)).toBe('[^n]: note body');
    expect(extractMetadata(model).linkOccurrences.some(link => link.label === 'link' && link.target === 'Note.md#Heading')).toBe(true);
  });
});
