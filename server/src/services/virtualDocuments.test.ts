import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const state = vi.hoisted(() => ({ root:'' }));
vi.mock('./settings.js', () => ({ getSettings:async () => ({vault:{path:state.root,trash:'.trash'},nativeFeatures:{}}) }));
vi.mock('./git.js', () => ({scheduleAutoCommitOnSave:vi.fn()}));
vi.mock('./fileupdates.js', () => ({queueFileUpdate:vi.fn(() => Promise.resolve())}));
import { virtualManifestSchema } from '../contracts/virtualDocument.js';
import { describeVirtualDocuments, defaultVirtualManifest, saveVirtualManifest, readVirtualManifest, disableVirtualDocument, resolveVirtualDocument } from './virtualDocuments.js';
import { listTree, clearVaultStats } from './vaultFile.js';
import { catalog, replaceCatalog, VaultCatalog } from './catalog.js';
const base=path.join(os.tmpdir(),'.agents');
beforeEach(async()=>{
  await fs.mkdir(base,{recursive:true}); state.root=await fs.mkdtemp(path.join(base,'virtual-doc-test-')); clearVaultStats(); replaceCatalog(new VaultCatalog());
  await fs.mkdir(state.root+'/Book/正文',{recursive:true});
  await Promise.all(['第10章.md','第02章.md'].map(name=>fs.writeFile(state.root+'/Book/正文/'+name,'\ufeff# Kept\r\n$$x$$ ^eq-original\r\n')));
  await fs.writeFile(state.root+'/Book/Book 索引.md','old index'); await fs.writeFile(state.root+'/Book/original.pdf','pdf bytes');
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
