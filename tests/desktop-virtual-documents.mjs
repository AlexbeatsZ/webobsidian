// Run: node --import tsx tests/desktop-virtual-documents.mjs <packaged executable>
// Optional VIRTUAL_REAL_VAULT reads source materials; all writes use a disposable copy.
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { _electron as electron, expect } from '@playwright/test';
import { makePdfFixture } from './browser/fixtures/pdf.ts';

const root = path.resolve(import.meta.dirname, '..');
const parent = path.join(process.platform === 'win32' ? os.tmpdir() : '/tmp', '.agents');
await fs.mkdir(parent, { recursive: true });
const fixture = await fs.mkdtemp(path.join(parent, 'virtual-native-'));
const profile = path.join(fixture, 'profile'), vault = path.join(fixture, 'vault');
const output = path.resolve(process.env.VIRTUAL_OUTPUT ?? path.join(fixture, 'evidence'));
await fs.mkdir(profile); await fs.mkdir(vault); await fs.mkdir(output, { recursive: true });
const book = '04资料/化学/物理化学/物理化学 第三版', slides = '04资料/化学/物理化学/物理化学 课件';
const original = new Map();
async function walk(directory, prefix = '') {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const relative = prefix ? prefix + '/' + entry.name : entry.name;
    if (entry.isDirectory()) result.push(...await walk(path.join(directory, entry.name), relative));
    else if (entry.isFile()) result.push(relative);
  }
  return result;
}
if (process.env.VIRTUAL_REAL_VAULT) {
  const source = path.resolve(process.env.VIRTUAL_REAL_VAULT), all = await walk(source);
  const candidates = all.filter(file => file.startsWith(book + '/'));
  const slideFiles = all.filter(file => file.startsWith(slides + '/') && file.endsWith('.pdf')).sort((a,b) => a.localeCompare(b,'zh-Hans-CN',{numeric:true})).slice(0,3);
  const selected = new Set([...candidates, ...slideFiles]);
  const names = new Map();
  for (const file of all) { const name = path.basename(file); const entries = names.get(name) ?? []; entries.push(file); names.set(name, entries); }
  for (const file of candidates.filter(file => file.endsWith('.md'))) {
    const text = await fs.readFile(path.join(source,file),'utf8');
    for (const match of text.matchAll(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]|!\[[^\]]*\]\(([^\s)]+)\)/g)) {
      let target = match[1] ?? match[2];
      try { target = decodeURIComponent(target); } catch { /* preserve literal */ }
      if (/^https?:/i.test(target)) continue;
      const matches = names.get(path.basename(target));
      if (matches?.length === 1) selected.add(matches[0]);
    }
  }
  for (const file of selected) {
    const target = path.join(vault,file); await fs.mkdir(path.dirname(target),{recursive:true});
    await fs.copyFile(path.join(source,file),target);
    if (file.endsWith('.md')) original.set(file,await fs.readFile(target));
  }
} else {
  await fs.mkdir(path.join(vault,book,'正文'),{recursive:true}); await fs.mkdir(path.join(vault,slides),{recursive:true});
  for (let chapter=1;chapter<=24;chapter++) {
    const file=book+`/正文/物理化学 第三版 第${String(chapter).padStart(2,'0')}章.md`;
    const text=`# Chapter ${chapter}\n\n$$x^2$$ ^eq-native-${chapter}\n\n`+'Independent chapter text.\n\n'.repeat(100);
    await fs.writeFile(path.join(vault,file),text); original.set(file,Buffer.from(text));
  }
  for (let index=1;index<=3;index++) await fs.writeFile(path.join(vault,slides,`物理化学 课件 第0${index}章.pdf`),makePdfFixture({pages:40}));
}
await fs.writeFile(path.join(profile,'desktop-config.json'),JSON.stringify({vaultPath:vault,trustedPlugins:false}));
const executable = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root,'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const args = process.argv[2] ? [] : [path.join(root,'desktop/dist/main.js')];
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({executablePath:executable,args:[...args,`--user-data-dir=${profile}`],cwd:fixture,env,timeout:120000});
const errors = [], reads = new Set();
try {
  const page=await app.firstWindow();page.on('pageerror',error=>errors.push(String(error)));
  page.on('request',request=>{
    const url=new URL(request.url());
    if(url.pathname==='/api/files/content'&&url.searchParams.get('path')?.endsWith('.md')) reads.add(url.searchParams.get('path'));
  });
  await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//,{timeout:120000});
  await expect(page.getByRole('button',{name:'大纲',exact:true})).toBeVisible({timeout:60000});
  await page.evaluate(async folders=>{
    const identity=await (await fetch('/api/vault-identity')).json();
    for(const folder of folders) {
      const response=await fetch('/api/files/virtual-document',{method:'PUT',headers:{'Content-Type':'application/json','X-Vault-Identity':identity.vault},body:JSON.stringify({folder})});
      if(!response.ok)throw new Error(await response.text());
    }
  },[book,slides]);
  for(const folder of ['04资料','04资料/化学','04资料/化学/物理化学']) {
    await page.locator(`[data-path="${folder}"]`).first().click();
  }
  const opened=Date.now();
  const bookRow = page.locator(`.tree-row[data-path="${book}"]`).first();
  await expect(bookRow).not.toHaveClass(/\bfolder\b/,{timeout:15000});
  await bookRow.click();
  await expect(page.getByRole('navigation',{name:'文档索引'})).toBeVisible();
  const firstOpenMs=Date.now()-opened;
  await expect(page.locator('.virtual-document-toolbar')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'切换分组：MD',exact:true})).toBeVisible();
  const mode=page.getByRole('button',{name:/— 切换视图/});
  await mode.click();await page.getByRole('menuitemcheckbox',{name:'实时预览',exact:true}).click();
  await page.getByRole('button',{name:'大纲',exact:true}).click();
  const index=page.getByRole('navigation',{name:'文档索引'});
  const chapter= index.getByRole('button').filter({hasText:'第18章'});
  const jump=Date.now();
  const selectedChapter = await chapter.count() ? chapter.first() : index.getByRole('button').nth(17);
  const selectedTitle = await selectedChapter.textContent();
  await selectedChapter.click();
  const selectedSource = page.locator('[data-virtual-source]').filter({has:page.getByRole('heading',{name:selectedTitle,exact:true})});
  await expect(selectedSource.locator('.cm-content')).toBeAttached({timeout:60000});
  await expect(selectedSource.locator('.cm-properties')).toBeHidden();
  await expect.poll(() => selectedSource.locator('.cm-line').evaluateAll(lines => {
    const root=document.querySelector('.virtual-document-scroll').getBoundingClientRect();
    return lines.some(line=>{const bounds=line.getBoundingClientRect();return bounds.width>0&&bounds.bottom>root.top&&bounds.top<root.bottom&&!!line.textContent?.trim();});
  }),{timeout:60000}).toBe(true);
  await expect(page.locator('[data-mounted="true"] mjx-container').first()).toBeAttached({timeout:60000});
  const chapterJumpMs=Date.now()-jump;
  const markdownMounted=await page.locator('[data-mounted="true"]').count();assert(markdownMounted<=6);
  await page.screenshot({path:path.join(output,'native-markdown.png')});
  const mdReadCount=reads.size;
  // Real keyboard edits persist only to their independent source in the copied Vault.
  const editedPath=await selectedSource.getAttribute('data-virtual-source');
  const editable=selectedSource.locator('.cm-content[contenteditable="true"]');
  await editable.click();await editable.press('ControlOrMeta+End');
  await page.keyboard.insertText('\n\nNative independent edit acceptance\n');
  await expect.poll(async()=>await fs.readFile(path.join(vault,editedPath),'utf8')).toContain('Native independent edit acceptance');
  for(const [file,bytes] of original)if(file!==editedPath)assert((await fs.readFile(path.join(vault,file))).equals(bytes),'Unrelated source changed: '+file);
  await editable.press('ControlOrMeta+z');
  await expect.poll(async()=>await fs.readFile(path.join(vault,editedPath),'utf8')).not.toContain('Native independent edit acceptance');
  await page.screenshot({path:path.join(output,'native-inline-editing.png')});
  // Configuration is a JSON editor in the same bottom-right group menu.
  await page.getByRole('button',{name:'切换分组：MD',exact:true}).click();
  await page.getByRole('menuitemcheckbox',{name:'配置',exact:true}).click();
  const configPath=path.join(vault,book,'.virtual-document.json');
  const originalConfig=await fs.readFile(configPath,'utf8');
  await expect(page.locator('.virtual-group-trigger > span')).toBeInViewport();
  assert.equal(await page.locator('.virtual-group-trigger').evaluate(element=>getComputedStyle(element).display),'flex');
  const configEditor=page.locator('.virtual-configuration-editor .cm-content[contenteditable="true"]');
  await expect(configEditor).toContainText('"version"');
  const highlightColors=await configEditor.locator('.cm-line span').evaluateAll(spans=>[...new Set(spans.map(span=>getComputedStyle(span).color))]);
  assert(highlightColors.length>1);
  await configEditor.click();await configEditor.press('ControlOrMeta+Home');
  await page.getByRole('button',{name:'切换分组：配置',exact:true}).click();
  await page.screenshot({path:path.join(output,'native-json-configuration.png')});
  await page.keyboard.press('Escape');

  const config=JSON.parse(originalConfig);config.streams[0].title='MD native acceptance';
  const nextConfig=JSON.stringify(config,null,2)+'\n';
  await configEditor.click();await configEditor.press('ControlOrMeta+a');await page.keyboard.insertText(nextConfig);
  await expect.poll(()=>fs.readFile(configPath,'utf8')).toBe(nextConfig);
  await expect(page.getByRole('button',{name:'切换分组：配置',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'切换分组：配置',exact:true}).click();
  await expect(page.getByRole('menuitemcheckbox',{name:'MD native acceptance',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');
  // A malformed draft must remain editable without replacing the last valid file.
  await configEditor.click();await configEditor.press('ControlOrMeta+a');
  const rejection=page.waitForResponse(response=>response.url().includes('/api/files/content')&&response.request().method()==='PUT'&&response.status()===400);
  await page.keyboard.insertText('{');await rejection;
  assert.equal(await fs.readFile(configPath,'utf8'),nextConfig);
  await expect(configEditor).toHaveText('{');
  await configEditor.click();await configEditor.press('ControlOrMeta+a');await page.keyboard.insertText(originalConfig);
  await expect.poll(()=>fs.readFile(configPath,'utf8')).toBe(originalConfig);
  await app.evaluate(({shell})=>{
    globalThis.nativeReveals=[];
    const open=shell.openPath.bind(shell),show=shell.showItemInFolder.bind(shell);
    shell.openPath=async target=>{const result=await open(target);globalThis.nativeReveals.push({kind:'folder',target,result});return result;};
    shell.showItemInFolder=target=>{show(target);globalThis.nativeReveals.push({kind:'file',target});};
  });
  await configEditor.click({button:'right'});await page.getByRole('menuitem',{name:'在 Finder 中显示',exact:true}).click();
  await expect.poll(()=>app.evaluate(()=>globalThis.nativeReveals.length)).toBe(1);
  await bookRow.click({button:'right'});await page.getByRole('menuitem',{name:'在 Finder 中打开',exact:true}).click();
  await expect.poll(()=>app.evaluate(()=>globalThis.nativeReveals.length)).toBe(2);
  const nativeReveals=await app.evaluate(()=>globalThis.nativeReveals);
  assert.equal(nativeReveals[0].target,await fs.realpath(configPath));assert.equal(nativeReveals[1].target,await fs.realpath(path.join(vault,book)));assert.equal(nativeReveals[1].result,'');
  await page.locator(`[data-path="${slides}"]`).first().click();
  await expect(page.getByRole('navigation',{name:'文档索引'})).toBeVisible();
  const pdfStart=Date.now();await page.getByRole('navigation',{name:'文档索引'}).getByRole('button').nth(1).click();
  await expect(page.locator('.virtual-document-scroll .pdf-page-surface.is-ready').first()).toBeVisible({timeout:60000});
  const pdfOpenMs=Date.now()-pdfStart,canvases=await page.locator('.virtual-document-scroll canvas').count();assert(canvases<15);
  await page.screenshot({path:path.join(output,'native-pdf.png')});
  for(const [file,bytes] of original)if(file!==editedPath)assert((await fs.readFile(path.join(vault,file))).equals(bytes),'Source changed: '+file);
  assert.deepEqual(errors,[]);
  const metrics=await app.evaluate(({app})=>app.getAppMetrics().map(({type,memory})=>({type,memory})));
  const result={executable,fixture,realMaterials:!!process.env.VIRTUAL_REAL_VAULT,sourceMarkdown:original.size,sourceMarkdownBytes:[...original.values()].reduce((sum,bytes)=>sum+bytes.length,0),
    firstOpenMs,chapterJumpMs,pdfOpenMs,markdownReadCount:mdReadCount,markdownMounted,pdfCanvases:canvases,unrelatedSourceBytesUnchanged:true,independentEditAndUndo:true,configurationValidSave:true,invalidConfigurationPreserved:true,jsonHighlightColors:highlightColors,nativeReveals,rendererErrors:errors,processMetrics:metrics};
  await fs.writeFile(path.join(output,'native-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
} catch(error) {
  const page=await app.firstWindow();await page.screenshot({path:path.join(output,'native-failure.png')}).catch(()=>{});
  const geometry=await page.evaluate(()=>({scroll:document.querySelector('.virtual-document-scroll')?.scrollTop,sources:[...document.querySelectorAll('[data-virtual-source]')].map(node=>({path:node.getAttribute('data-virtual-source'),mounted:node.getAttribute('data-mounted'),top:node.getBoundingClientRect().top,height:node.getBoundingClientRect().height,bodyHeight:node.firstElementChild?.getBoundingClientRect().height,lines:node.querySelectorAll('.cm-line').length}))})).catch(()=>null);
  await fs.writeFile(path.join(output,'native-failure.json'),JSON.stringify({fixture,error:String(error),rendererErrors:errors,geometry},null,2));throw error;
} finally { await app.close(); }
