import { test, expect } from './test';

test.beforeEach(async ({ page }) => {
  await page.goto('/__render-test');
  await page.waitForFunction(() => !!window.renderHarness);
});

const note = '\ufeffbefore\r\n\r\n# Part ^heading-part\r\n\r\nbody\r\n\r\n# End\r\nafter';

test('explicit edit shares source history, preserves raw boundaries and updates both embeds', async ({ page }) => {
  await page.evaluate(note => {
    window.renderHarness.notes({ 'note.md': note });
    window.renderHarness.reset('![[note#^heading-part]]\n\nsentinel');
  }, note);
  await page.evaluate(() => window.renderHarness.mode(0, 'reading'));
  const left = page.locator('[data-slot="0"] .cm-note-embed');
  const right = page.locator('[data-slot="1"] .cm-note-embed');
  await expect(left.getByRole('button', { name: '编辑嵌入' })).toBeVisible();
  await expect(left.locator('.cm-typed-heading-fragment .cm-leading-heading')).toBeVisible();
  await expect(left.locator('.cm-typed-heading-fragment .cm-leading-heading')).toContainText('Part');
  await expect(left.locator('.cm-content[contenteditable="true"]')).toHaveCount(0);
  await left.getByRole('button', { name: '编辑嵌入' }).click();
  const editor = left.locator('.cm-content[contenteditable="true"]');
  await expect(editor).toBeVisible();
  await editor.press('Control+End');
  await editor.press('ArrowLeft');
  await editor.press('ArrowLeft');
  await editor.press('End');
  await editor.pressSequentially(' EDIT');
  await expect.poll(() => page.evaluate(() => window.renderHarness.noteSource('note.md'))).toContain(' EDIT');
  await expect(right).toContainText(' EDIT');
  const edited = await page.evaluate(() => window.renderHarness.noteSource('note.md'));
  expect(edited?.startsWith('\ufeffbefore\r\n\r\n')).toBe(true);
  expect(edited?.endsWith('# End\r\nafter')).toBe(true);
  await editor.press('Control+z');
  await expect.poll(() => page.evaluate(() => window.renderHarness.noteSource('note.md'))).toBe(note);
  await editor.press('Control+Shift+Z');
  await expect.poll(() => page.evaluate(() => window.renderHarness.noteSource('note.md'))).toBe(edited);
  await left.getByRole('button', { name: '完成', exact: true }).click();
  await expect(left.locator('.cm-content[contenteditable="true"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.renderHarness.source(0))).toBe('![[note#^heading-part]]\n\nsentinel');
});

test('source removal fails closed, and print cannot expose edit controls', async ({ page }) => {
  await page.evaluate(note => { window.renderHarness.notes({ 'note.md': note }); window.renderHarness.reset('![[note#^heading-part]]\n\nsentinel'); }, note);
  const embed = page.locator('[data-slot="1"] .cm-note-embed');
  await embed.getByRole('button', { name: '编辑嵌入' }).click();
  await expect(embed.locator('.cm-content[contenteditable="true"]')).toBeVisible();
  await page.evaluate(() => window.renderHarness.changeNote('note.md', 'deleted'));
  await expect(embed.getByRole('alert')).toContainText('找不到');
  expect(await page.evaluate(() => window.renderHarness.noteSource('note.md'))).toBe('\ufeffdeleted');
  await page.evaluate(note => window.renderHarness.changeNote('note.md', note), note);
  await page.evaluate(() => window.renderHarness.preparePrint());
  const print = page.frameLocator('.note-print-frame');
  await expect(print.locator('.cm-note-embed')).toHaveCount(1);
  await expect(print.locator('.cm-embed-edit')).toHaveCount(0);
});

test('global typed links use source labels and preserve explicit aliases through title edits', async ({ page }) => {
  await page.evaluate(() => {
    window.renderHarness.notes({ 'note.md': '# Original ^heading-global\n\nbody' });
    window.renderHarness.reset('[[^heading-global]] and [[^heading-global|Alias]]\n\nsentinel');
  });
  const links = page.locator('[data-slot="1"] .cm-wikilink');
  await expect(links).toHaveText(['Original', 'Alias']);
  await page.evaluate(() => window.renderHarness.changeNote('note.md', '# Renamed ^heading-global\n\nbody'));
  await expect(links).toHaveText(['Renamed', 'Alias']);
});

test('range editors remap source deltas and reject boundary merges and out-of-range writes', async ({ page }) => {
  const raw = 'before\n\n^range-section:start\n\nfirst\n\nsecond\n\n^range-section:end\n\nafter';
  await page.evaluate(raw => {
    window.renderHarness.notes({ 'range.md': raw });
    window.renderHarness.reset('![[^range-section]]\n\nsentinel');
  }, raw);
  const embed = page.locator('[data-slot="1"] .cm-note-embed');
  await embed.getByRole('button', { name: '编辑嵌入' }).click();
  await expect(embed.locator('.cm-content[contenteditable="true"]')).toBeVisible();
  const text = await page.evaluate(() => window.renderHarness.embedText(1));
  expect(text).toBe('\nfirst\n\nsecond\n\n');
  await page.evaluate(length => window.renderHarness.editEmbed(1, [{ from: length - 2, to: length, insert: '' }]), text!.length);
  expect(await page.evaluate(() => window.renderHarness.noteSource('range.md'))).toBe(raw);
  await page.evaluate(raw => window.renderHarness.changeNote('range.md', 'prefix\n' + raw), raw);
  await page.evaluate(() => window.renderHarness.editEmbed(1, [{ from: 1, to: 6, insert: 'changed' }]));
  await expect.poll(() => page.evaluate(() => window.renderHarness.noteSource('range.md'))).toBe(('prefix\n' + raw).replace('first', 'changed'));
  await embed.getByRole('button', { name: '完成', exact: true }).click();
  await page.evaluate(() => window.renderHarness.reset('^range-section:start\n\nbody\n\n^range-section:end\n\nsentinel'));
  const reading = page.locator('[data-slot="1"]');
  await expect(reading.locator('.cm-content')).not.toContainText('^range-section');
});

test('normal edits cannot alter target IDs and concurrent composition fails closed', async ({ page }) => {
  await page.evaluate(note => { window.renderHarness.notes({ 'note.md': note }); window.renderHarness.reset('![[note#^heading-part]]\n\nsentinel'); }, note);
  const embed = page.locator('[data-slot="1"] .cm-note-embed');
  await embed.getByRole('button', { name: '编辑嵌入' }).click();
  const editor = embed.locator('.cm-content[contenteditable="true"]');
  await expect(editor).toBeVisible();
  await page.evaluate(() => {
    const at = window.renderHarness.embedText(1)!.indexOf('^heading-part');
    window.renderHarness.editEmbed(1, [{ from: at, to: at + 1, insert: '' }]);
  });
  expect(await page.evaluate(() => window.renderHarness.noteSource('note.md'))).toBe(note);
  await editor.dispatchEvent('compositionstart', { data: '' });
  await page.evaluate(note => window.renderHarness.changeNote('note.md', note.replace('body', 'external')), note);
  await editor.dispatchEvent('compositionend', { data: '' });
  await expect(embed.locator('.cm-content[contenteditable="true"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.renderHarness.noteSource('note.md'))).toBe(note.replace('body', 'external'));
});

test('active embeds and labels follow a global target moved to another file', async ({ page }) => {
  await page.evaluate(() => {
    window.renderHarness.notes({ 'first.md': '# Old ^heading-moving\n\nold body', 'second.md': 'empty' });
    window.renderHarness.reset('[[^heading-moving]]\n\n![[^heading-moving]]\n\nsentinel');
  });
  const pane = page.locator('[data-slot="1"]');
  await expect(pane.locator('.cm-wikilink')).toHaveText('Old');
  await expect(pane.locator('.cm-note-embed')).toContainText('old body');
  await page.evaluate(() => {
    window.renderHarness.changeNote('first.md', 'removed');
    window.renderHarness.changeNote('second.md', '# New ^heading-moving\n\nnew body');
  });
  await expect(pane.locator('.cm-wikilink')).toHaveText('New');
  await expect(pane.locator('.cm-note-embed')).toContainText('new body');
});

for (const initial of ['missing', 'ambiguous'] as const) test(`initially ${initial} global links and embeds recover without reopening`, async ({ page }) => {
  await page.evaluate(initial => {
    window.renderHarness.notes({ 'first.md': initial === 'missing' ? 'empty' : '# First ^heading-later\n\nfirst body',
      'second.md': initial === 'missing' ? 'empty' : '# Second ^heading-later\n\nsecond body' });
    window.renderHarness.reset('[[^heading-later]]\n\n![[^heading-later]]\n\nsentinel');
  }, initial);
  const pane = page.locator('[data-slot="1"]'), embed = pane.locator('.cm-note-embed');
  await expect(embed.getByRole('alert')).toContainText('找不到');
  await expect(embed.getByRole('button', { name: '编辑嵌入' })).toHaveCount(0);
  await expect(pane.locator('.cm-wikilink')).toHaveClass(/is-unresolved/);
  await page.evaluate(() => {
    window.renderHarness.changeNote('first.md', 'removed');
    window.renderHarness.changeNote('second.md', '# Available ^heading-later\n\nnew body');
  });
  await expect(pane.locator('.cm-wikilink')).toHaveText('Available');
  await expect(embed).toContainText('new body');
  await embed.getByRole('button', { name: '编辑嵌入' }).click();
  await expect(embed.locator('.cm-content[contenteditable="true"]')).toBeVisible();
});

test('same-file range embeds render acyclic content but whole-file self embeds remain blocked', async ({ page }) => {
  await page.evaluate(() => window.renderHarness.reset('![[#^range-local]]\n\n^range-local:start\n\nlocal body\n\n^range-local:end\n\nsentinel'));
  const pane = page.locator('[data-slot="1"]');
  await expect(pane.locator('.cm-note-embed')).toContainText('local body');
  await expect(pane.locator('.cm-note-embed [role="alert"]')).toHaveCount(0);
  await page.evaluate(() => window.renderHarness.reset('![[a]]\n\nsentinel'));
  await expect(pane.locator('.cm-note-embed [role="alert"]')).toContainText('循环嵌入');
});

test('scoped and global links to the same recursive fragment share one cycle identity', async ({ page }) => {
  await page.evaluate(() => {
    window.renderHarness.notes({ 'recursive.md': '# Recursive ^heading-recursive\n\n![[recursive#^heading-recursive]]' });
    window.renderHarness.reset('![[^heading-recursive]]\n\nsentinel');
  });
  await expect(page.locator('[data-slot="1"] .cm-note-embed [role="alert"]')).toContainText('循环嵌入');
  await expect(page.locator('[data-slot="1"] .cm-note-embed')).toHaveCount(2);
});
