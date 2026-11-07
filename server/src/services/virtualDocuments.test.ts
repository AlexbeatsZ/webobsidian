import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const state = vi.hoisted(() => ({ root:'' }));
vi.mock('./settings.js', () => ({ getSettings:async () => ({vault:{path:state.root,trash:'.trash'},nativeFeatures:{}}) }));
vi.mock('./git.js', () => ({scheduleAutoCommitOnSave:vi.fn()}));
vi.mock('./fileupdates.js', () => ({queueFileUpdate:vi.fn(() => Promise.resolve())}));
import { virtualManifestSchema } from '../contracts/virtualDocument.js';
import { describeVirtualDocuments, defaultVirtualManifest, saveVirtualManifest, readVirtualManifest, disableVirtualDocument, resolveVirtualDocument, validateVirtualManifestText, prepareVirtualSourceRename } from './virtualDocuments.js';
import { listTree, clearVaultStats } from './vaultFile.js';
import { catalog, replaceCatalog, VaultCatalog } from './catalog.js';
import { rename } from './vault.js';
import { queueFileUpdate } from './fileupdates.js';
import { scheduleAutoCommitOnSave } from './git.js';
const base=path.join(os.tmpdir(),'.agents');
beforeEach(async()=>{
  await fs.mkdir(base,{recursive:true}); state.root=await fs.mkdtemp(path.join(base,'virtual-doc-test-')); clearVaultStats(); replaceCatalog(new VaultCatalog());
  await fs.mkdir(state.root+'/Book/正文',{recursive:true});
  await Promise.all(['第10章.md','第02章.md'].map(name=>fs.writeFile(state.root+'/Book/正文/'+name,'\ufeff# Kept\r\n$$x$$ ^eq-original\r\n')));
  await fs.writeFile(state.root+'/Book/Book 索引.md','old index'); await fs.writeFile(state.root+'/Book/original.pdf','pdf bytes');
  vi.clearAllMocks();
});
afterEach(async()=>{ if(path.dirname(state.root)!==base)throw new Error('Unsafe cleanup');await fs.rm(state.root,{recursive:true,force:true}); });
it('rejects traversal, hidden source paths, unsupported files and duplicate identities',()=>{
  for(const source of ['../secret.md','/secret.md','.obsidian/config.md','a/../../b.pdf','a\\b.md','x.js','a.md#heading'])
    expect(virtualManifestSchema.safeParse({version:1,title:'Book',streams:[{id:'text',title:'Text',files:[source]}]}).success).toBe(false);
  expect(virtualManifestSchema.safeParse({version:1,title:'Book',streams:[{id:'text',title:'Text',files:['A.md','a.md']}]}).success).toBe(false);
});
it('creates only a hidden descriptor, naturally orders sources and excludes former indexes',async()=>{
  const tree=await listTree(),folder=tree.children!.find(node=>node.path==='Book')!;
  const manifest=defaultVirtualManifest(folder);
  expect(manifest.streams[0].files).toEqual(['正文/第02章.md','正文/第10章.md']);
  await saveVirtualManifest('Book',manifest);
  const projected=await describeVirtualDocuments(await listTree()),collection=projected.children!.find(node=>node.path==='Book')!.virtualDocument!;
  expect(collection.streams[0].files.map(file=>file.path)).toEqual(['Book/正文/第02章.md','Book/正文/第10章.md']);
  expect(await fs.readFile(state.root+'/Book/正文/第02章.md','utf8')).toBe('\ufeff# Kept\r\n$$x$$ ^eq-original\r\n');
  expect(projected.children![0].children!.some(node=>node.name.startsWith('.'))).toBe(false);
});
it('rejects stale writes and disabling moves only the descriptor to recoverable trash',async()=>{
  const manifest=defaultVirtualManifest((await listTree()).children![0]);
  await saveVirtualManifest('Book',manifest);const current=(await readVirtualManifest('Book'))!;
  await expect(saveVirtualManifest('Book',manifest,'stale')).rejects.toMatchObject({status:409});
  await expect(disableVirtualDocument('Book','stale')).rejects.toMatchObject({status:409});
  await disableVirtualDocument('Book',current.revision);
  expect(await readVirtualManifest('Book')).toBeNull();
  expect(await fs.readFile(state.root+'/Book/original.pdf','utf8')).toBe('pdf bytes');
  expect(await fs.readFile(state.root+'/Book/Book 索引.md','utf8')).toBe('old index');
});
it('reports malformed config while preserving the physical folder and all source files',async()=>{
  await fs.writeFile(state.root+'/Book/.virtual-document.json','{"version":1,"streams":[]}');
  const folder=(await describeVirtualDocuments(await listTree())).children![0];
  expect(folder.virtualDocument).toBeUndefined();expect(folder.virtualDocumentError).toContain('配置无效');
  expect(folder.children!.length).toBe(3);
});
it('resolves a virtual document as a link target without replacing member file identities',async()=>{
  await saveVirtualManifest('Book',defaultVirtualManifest((await listTree()).children![0]));
  catalog.putPath('Book',true);
  expect(await resolveVirtualDocument('Book','note.md')).toMatchObject({status:'resolved',path:'Book'});
  expect(await resolveVirtualDocument('^eq-original','note.md')).toBeUndefined();
  expect(await resolveVirtualDocument('../outside','note.md')).toBeUndefined();
});
it('validates JSON editor drafts without overwriting the last valid descriptor', async () => {
  const manifest=defaultVirtualManifest((await listTree()).children![0]);expect(manifest.streams[0].title).toBe('MD');
  await saveVirtualManifest('Book',manifest);const current=(await readVirtualManifest('Book'))!;
  for (const raw of ['{', '{"version":1,"streams":[]}', JSON.stringify({...manifest,streams:[{id:'bad',title:'MD',files:['../outside.md']}]})])
    await expect(validateVirtualManifestText('Book',raw)).rejects.toThrow();
  expect((await readVirtualManifest('Book'))!.revision).toBe(current.revision);
  const valid='// Keep this comment\n'+JSON.stringify(manifest,null,2);
  expect(await validateVirtualManifestText('Book',valid)).toEqual(manifest);
});

async function renameFixture() {
  const manifest=defaultVirtualManifest((await listTree()).children![0]);
  manifest.streams.push({id:'review',title:'Review',files:['正文/第02章.md']});
  const content='\uFEFF// Keep configuration comments\r\n'+JSON.stringify(manifest,null,2).replaceAll('\n','\r\n')+'\r\n';
  await fs.writeFile(state.root+'/Book/.virtual-document.json',content);
  return (await readVirtualManifest('Book'))!;
}

it('renames a real source and every stream reference while preserving JSONC layout and source bytes', async () => {
  const current=await renameFixture(),from='Book/正文/第02章.md',to='Book/正文/新标题.md';
  const original=await fs.readFile(state.root+'/'+from);
  const update=await prepareVirtualSourceRename('Book',current.revision,from,to);
  await rename(from,to,undefined,update);
  expect(await fs.readFile(state.root+'/'+to)).toEqual(original);
  await expect(fs.stat(state.root+'/'+from)).rejects.toMatchObject({code:'ENOENT'});
  const saved=(await readVirtualManifest('Book'))!;
  expect(saved.content).toBe(current.content.replaceAll('正文/第02章.md','正文/新标题.md'));
  expect(saved.manifest.streams.map(stream=>stream.files)).toEqual([
    ['正文/新标题.md','正文/第10章.md'],['original.pdf'],['正文/新标题.md'],
  ]);
  const projected=(await describeVirtualDocuments(await listTree())).children![0].virtualDocument!;
  expect(projected.streams[0].files[0]).toMatchObject({path:to,title:'新标题',missing:false});
  expect(await fs.readFile(state.root+'/Book/正文/第10章.md','utf8')).toBe('\uFEFF# Kept\r\n$$x$$ ^eq-original\r\n');
});

it('rejects stale configuration and invalid or colliding source names before moving any file', async () => {
  const current=await renameFixture(),from='Book/正文/第02章.md';
  await expect(prepareVirtualSourceRename('Book','stale',from,'Book/正文/new.md')).rejects.toMatchObject({status:409});
  for(const to of ['Book/new.md','Book/正文/.hidden.md','Book/正文/bad#name.md','Book/正文/new.pdf','Book/正文/第10章.md'])
    await expect(prepareVirtualSourceRename('Book',current.revision,from,to)).rejects.toThrow();
  await expect(prepareVirtualSourceRename('Book',current.revision,'Book/Book 索引.md','Book/Other.md')).rejects.toThrow('不属于');
  expect((await readVirtualManifest('Book'))!.content).toBe(current.content);
  expect(await fs.readFile(state.root+'/'+from,'utf8')).toBe('\uFEFF# Kept\r\n$$x$$ ^eq-original\r\n');
  expect(queueFileUpdate).not.toHaveBeenCalled();
  expect(scheduleAutoCommitOnSave).not.toHaveBeenCalled();
});

it('rolls back a moved source if the descriptor changes before its write commits', async () => {
  const current=await renameFixture(),from='Book/正文/第02章.md',to='Book/正文/new.md';
  const update=await prepareVirtualSourceRename('Book',current.revision,from,to);
  const external=current.content.replace('"title": "Book"','"title": "External"');
  await fs.writeFile(state.root+'/Book/.virtual-document.json',external);
  await expect(rename(from,to,undefined,update)).rejects.toMatchObject({status:409});
  expect(await fs.readFile(state.root+'/'+from,'utf8')).toBe('\uFEFF# Kept\r\n$$x$$ ^eq-original\r\n');
  await expect(fs.stat(state.root+'/'+to)).rejects.toMatchObject({code:'ENOENT'});
  expect(await fs.readFile(state.root+'/Book/.virtual-document.json','utf8')).toBe(external);
  expect(queueFileUpdate).not.toHaveBeenCalled();
  expect(scheduleAutoCommitOnSave).not.toHaveBeenCalled();
});

it('keeps both source and existing target if the destination is already occupied', async () => {
  const current=await renameFixture(),from='Book/正文/第02章.md',to='Book/正文/occupied.md';
  await fs.writeFile(state.root+'/'+to,'keep existing destination');
  const update=await prepareVirtualSourceRename('Book',current.revision,from,to);
  await expect(rename(from,to,undefined,update)).rejects.toMatchObject({status:409});
  expect(await fs.readFile(state.root+'/'+to,'utf8')).toBe('keep existing destination');
  expect(await fs.readFile(state.root+'/'+from,'utf8')).toBe('\uFEFF# Kept\r\n$$x$$ ^eq-original\r\n');
  expect((await readVirtualManifest('Book'))!.content).toBe(current.content);
  expect(queueFileUpdate).not.toHaveBeenCalled();
});

it('restores the exact original filename after a case-only rename cannot save its configuration', async () => {
  const current=await renameFixture();
  await fs.writeFile(state.root+'/Book/正文/Original.md','case-only source');
  const manifest={...current.manifest,streams:[{id:'text',title:'MD',files:['正文/Original.md']}]};
  await fs.writeFile(state.root+'/Book/.virtual-document.json',JSON.stringify(manifest));
  const ready=(await readVirtualManifest('Book'))!;
  const update=await prepareVirtualSourceRename('Book',ready.revision,'Book/正文/Original.md','Book/正文/original.md');
  await fs.writeFile(state.root+'/Book/.virtual-document.json',JSON.stringify({...manifest,title:'Concurrent edit'}));
  await expect(rename('Book/正文/Original.md','Book/正文/original.md',undefined,update)).rejects.toMatchObject({status:409});
  const names=await fs.readdir(state.root+'/Book/正文');
  expect(names).toContain('Original.md');expect(names).not.toContain('original.md');
  expect(await fs.readFile(state.root+'/Book/正文/Original.md','utf8')).toBe('case-only source');
});
