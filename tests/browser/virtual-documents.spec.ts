import { test, expect } from './test';
import { makePdfFixture } from './fixtures/pdf';

test('virtual Markdown chapters stay bounded, jump through one outline and edit only the real source', async ({ page }, testInfo) => {
  const folder = '化学/物理化学/物理化学 第三版';
  const files = Array.from({ length: 30 }, (_, index) => ({ path: `${folder}/正文/物理化学 第三版 第${String(index + 1).padStart(2,'0')}章.md`,
    title: `章节 ${index + 1}`, kind: 'markdown', size: 100000, headings: [{ text: `定义 ${index + 1}`, level: 1 }, { text: `应用 ${index + 1}`, level: 2 }] }));
  const collection = { path: folder, title: '物理化学 第三版', revision: 'fixture-v1', streams: [{ id:'text',title:'MD',files }] };
  const reads: string[] = [], writes: {path:string;content:string}[] = [];
  await page.route('**/api/**', async route => {
    const request=route.request(),url=new URL(request.url());
    if (url.pathname==='/api/vault-identity'||url.pathname==='/api/writing') return route.fallback();
    if (url.pathname==='/api/files/content') {
      if(request.method()==='PUT') { writes.push(request.postDataJSON()); return route.fulfill({json:{ok:true,revision:'saved'}}); }
      const path=url.searchParams.get('path')!; reads.push(path);
      const index=files.findIndex(file=>file.path===path)+1;
      return route.fulfill({json:{path,content:`---\ntags: [fixture]\n---\n\n# 定义 ${index}\n\n$$x^2$$ ^eq-fixture-${index}\n\n`+('正文与公式的独立章节内容。\n\n'.repeat(600))+`## 应用 ${index}\n\n章节结尾。\n`,revision:'original',vault:'browser-fixture'}});
    }
    if(url.pathname.replace(/\/$/,'')==='/api/uistate') return route.fulfill({json:{}});
    if(url.pathname==='/api/property-types') return route.fulfill({json:{types:{}}});
    return route.fulfill({json:{hits:[],matches:[],backlinks:[],outgoing:[],enabled:false}});
  });
  await page.goto('/__render-test'); await page.waitForFunction(()=>!!window.renderHarness);
  await page.evaluate(async ({folder,files,collection})=>{
    const load=(path:string)=>import(path);
    const [React,ReactDOM,{default:Workspace},{default:RightSidebar},store,{documents},{publishVirtualDocuments}]=await Promise.all([
      load('/node_modules/.vite/deps/react.js'),load('/node_modules/.vite/deps/react-dom_client.js'),load('/src/components/Workspace.tsx'),
      load('/src/components/RightSidebar.tsx'),load('/src/lib/store.ts'),load('/src/lib/documents.ts'),load('/src/lib/virtualDocuments.ts')]);
    document.getElementById('root')!.hidden=true;
    const host=document.createElement('div');host.id='virtual-fixture';host.style.cssText='position:fixed;inset:0';document.body.append(host);
    const tree={name:'Fixture',path:'',type:'folder',children:[{name:collection.title,path:folder,type:'folder',virtualDocument:collection,
      children:files.map(file=>({name:file.path.split('/').pop(),path:file.path,type:'file',ext:'.md'}))}]};
    await store.useStore.getState().loadUiState();publishVirtualDocuments(tree);
    store.useStore.setState({tree,rightOpen:true,rightPanel:'outline',rightTabs:[],rightActiveId:null,viewMode:'live',filePaths:files.map(file=>file.path)});
    await store.useStore.getState().openFile(folder);
    const h=(React.default??React).createElement;
    (ReactDOM.createRoot??ReactDOM.default.createRoot)(host).render(h('div',{className:'app theme-dark'},h(Workspace),h(RightSidebar,{open:true})));
    (window as any).virtualFixture={...store,documents,files};
  },{folder,files,collection});
  const host=page.locator('#virtual-fixture');
  await expect(host.getByRole('navigation',{name:'文档索引'})).toBeVisible();
  await expect(host.locator('[data-mounted="true"] .cm-content').first()).toContainText('定义 1');
  await expect(host.locator('[data-mounted="true"] .cm-properties').first()).toBeHidden();
  await expect.poll(()=>reads.length).toBeLessThanOrEqual(6);
  expect(await page.evaluate(()=> (window as any).virtualFixture.documents.snapshots().length)).toBeLessThanOrEqual(6);
  await expect(host.locator('.virtual-document-toolbar')).toHaveCount(0);
  await expect(host.getByRole('button',{name:'切换分组：MD',exact:true})).toBeVisible();
  await expect(host.locator('.virtual-group-trigger > span')).toBeInViewport();
  expect(await host.locator('.virtual-group-trigger').evaluate(element=>getComputedStyle(element).display)).toBe('flex');
  const outline=host.getByRole('navigation',{name:'连续文档大纲'});
  await outline.getByRole('button',{name:'应用 29',exact:true}).click();
  await expect(host.locator('[data-virtual-source]').nth(28).locator('.cm-content')).toContainText('应用 29');
  await expect.poll(()=>host.locator('[data-mounted="true"]').count()).toBeLessThanOrEqual(6);
  await expect(host.locator('[data-virtual-source]').nth(28)).toHaveAttribute('data-mounted','true');
  await expect(host.locator('[data-virtual-source]').nth(28).locator('.cm-content')).toBeInViewport();
  await expect(host.locator('[data-virtual-source]').nth(28).locator('.cm-line').filter({hasText:'应用 29'})).toBeInViewport();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-virtual-source]')].slice(27).every(node=>!node.querySelector('[role="status"]')));
  await expect(host.locator('[data-virtual-source]').nth(28).locator('.cm-content')).toBeInViewport();
  await expect(host.locator('[data-virtual-source]').nth(29).locator('mjx-container')).toBeAttached();
  await testInfo.attach('markdown-window.json',{body:JSON.stringify({reads:reads.length,mounted:await host.locator('[data-mounted="true"]').count(),chapterSessions:await page.evaluate(()=>(window as any).virtualFixture.documents.snapshots().length)}),contentType:'application/json'});
  await page.screenshot({path:testInfo.outputPath('virtual-markdown-outline.png')});
  await host.locator('[data-virtual-source]').nth(28).evaluate(element=>element.scrollIntoView({block:'end'}));
  await host.locator('.virtual-document-scroll').hover();await page.mouse.wheel(0,900);
  await expect(host.locator('[data-virtual-source]').nth(29).locator('.cm-content')).toBeInViewport();
  const editable=host.locator('[data-virtual-source]').nth(28).locator('.cm-content[contenteditable="true"]');
  await editable.click();await editable.press('ControlOrMeta+End');await editable.press('Enter');await editable.type('独立编辑验收29');
  await expect.poll(()=>writes.some(write=>write.path===files[28].path&&write.content.includes('独立编辑验收29'))).toBe(true);
  const next=host.locator('[data-virtual-source]').nth(29).locator('.cm-content[contenteditable="true"]');
  await next.click();await next.press('ControlOrMeta+End');await next.press('Enter');await next.type('独立编辑验收30');
  await expect.poll(()=>writes.some(write=>write.path===files[29].path&&write.content.includes('独立编辑验收30'))).toBe(true);
  await editable.click();await editable.press('ControlOrMeta+z');
  await expect.poll(()=>page.evaluate(path=>(window as any).virtualFixture.documents.get(path).snapshot.raw,files[28].path)).not.toContain('独立编辑验收29');
  await expect.poll(()=>page.evaluate(path=>(window as any).virtualFixture.documents.get(path).snapshot.raw,files[29].path)).toContain('独立编辑验收30');
  expect(writes.every(write=>[files[28].path,files[29].path].includes(write.path))).toBe(true);
  expect(await page.evaluate(()=>(window as any).virtualFixture.useStore.getState().activePath)).toBe(folder);
  await page.evaluate(async()=>{await (window as any).virtualFixture.useStore.getState().openFile('outside.md');});
  await expect.poll(()=>page.evaluate(()=>(window as any).virtualFixture.documents.snapshots().length)).toBe(3);
  await page.evaluate(async folder=>{await (window as any).virtualFixture.useStore.getState().openFile(folder);},folder);
  await expect(host.getByRole('navigation',{name:'文档索引'})).toBeAttached();
});

test('status groups include highlighted JSON configuration, retain edits through refresh and reveal native locations', async ({page},testInfo)=>{
  const folder='Book',configPath=folder+'/.virtual-document.json';
  let manifest={version:1,title:'Book',streams:[{id:'text',title:'MD',files:['chapter.md']},{id:'pdf',title:'PDF',files:['original.pdf']}]};
  let raw=JSON.stringify(manifest,null,2);const writes:{path:string;content:string}[]=[];
  const collection=()=>({path:folder,title:'Book',revision:raw,streams:manifest.streams.map(stream=>({...stream,files:stream.files.map(file=>({path:folder+'/'+file,title:file,kind:file.endsWith('.pdf')?'pdf':'markdown',size:200,headings:[]}))}))});
  const tree=()=>({name:'Fixture',path:'',type:'folder',children:[{name:'Book',path:folder,type:'folder',virtualDocument:collection()}]});
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/api/vault-identity'||url.pathname==='/api/writing')return route.fallback();
    if(url.pathname.replace(/\/$/,'')==='/api/files')return route.fulfill({json:tree()});
    if(url.pathname==='/api/files/content'){
      if(route.request().method()==='PUT'){
        const write=route.request().postDataJSON();writes.push(write);
        if(write.path===configPath){manifest=JSON.parse(write.content);raw=write.content;}
        return route.fulfill({json:{ok:true,revision:'updated'}});
      }
      const path=url.searchParams.get('path');
      if(path?.endsWith('.pdf'))return route.fulfill({contentType:'application/pdf',body:makePdfFixture({pages:3})});
      return route.fulfill({json:{path,content:path===configPath?raw:'# Independent chapter\n\nKept.',revision:'v1',vault:'browser-fixture'}});
    }
    if(url.pathname.replace(/\/$/,'')==='/api/uistate')return route.fulfill({json:{}});
    return route.fulfill({json:{hits:[],matches:[],types:{},enabled:false}});
  });
  await page.goto('/__render-test');await page.waitForFunction(()=>!!window.renderHarness);
  await page.evaluate(async tree=>{
    const load=(path:string)=>import(path);
    const [React,ReactDOM,{default:Workspace},{default:Tabs},{default:ContextMenu},store,{publishVirtualDocuments}]=await Promise.all([
      load('/node_modules/.vite/deps/react.js'),load('/node_modules/.vite/deps/react-dom_client.js'),load('/src/components/Workspace.tsx'),
      load('/src/components/WorkspaceTabs.tsx'),load('/src/components/ContextMenu.tsx'),load('/src/lib/store.ts'),load('/src/lib/virtualDocuments.ts')]);
    (window as any).nativeReveals=[];(window as any).webobsidianDesktop={isDesktop:true,platform:'darwin',revealVaultPath:async(path:string)=>{(window as any).nativeReveals.push(path);}};
    document.getElementById('root')!.hidden=true;const host=document.createElement('div');host.id='virtual-config-fixture';host.style.cssText='position:fixed;inset:0';document.body.append(host);
    await store.useStore.getState().loadUiState();publishVirtualDocuments(tree);store.useStore.setState({tree,rightOpen:false,viewMode:'live'});
    await store.useStore.getState().openFile('Book');const h=(React.default??React).createElement;
    (ReactDOM.createRoot??ReactDOM.default.createRoot)(host).render(h('div',{className:'app theme-dark'},h(Tabs),h(Workspace),h(ContextMenu)));
    (window as any).virtualConfigStore=store.useStore;
  },tree());
  const host=page.locator('#virtual-config-fixture');await expect(host.getByRole('button',{name:'切换分组：MD'})).toBeVisible();
  await host.getByRole('button',{name:'切换分组：MD'}).click();await host.getByRole('menuitemcheckbox',{name:'配置',exact:true}).click();
  const editor=host.locator('.virtual-configuration-editor .cm-content');await expect(editor).toHaveAttribute('contenteditable','true');
  await expect(editor).toContainText('"version"');
  const colors=await editor.locator('.cm-line span').evaluateAll(spans=>[...new Set(spans.map(span=>getComputedStyle(span).color))]);expect(colors.length).toBeGreaterThan(1);
  await editor.click({button:'right'});await host.getByRole('menuitem',{name:'在 Finder 中显示',exact:true}).click();
  expect(await page.evaluate(()=>(window as any).nativeReveals)).toEqual([configPath]);
  const updated={...manifest,streams:manifest.streams.map(stream=>({...stream,title:stream.id==='text'?'MD 新分组':stream.title}))};
  await editor.click();await editor.press('ControlOrMeta+a');await page.keyboard.insertText(JSON.stringify(updated,null,2));
  await expect.poll(()=>writes.some(write=>write.path===configPath&&write.content.includes('MD 新分组'))).toBe(true);
  expect(writes.every(write=>write.path===configPath&&write.content.startsWith('{'))).toBe(true);
  await page.evaluate(async()=>{await (window as any).virtualConfigStore.getState().loadTree();});
  await expect(host.getByRole('button',{name:'切换分组：配置'})).toBeVisible();await expect(editor).toContainText('MD 新分组');
  await host.getByRole('button',{name:'切换分组：配置'}).click();await host.getByRole('menuitemcheckbox',{name:'PDF',exact:true}).click();
  await expect(host.getByRole('button',{name:'切换分组：PDF'})).toBeVisible();
  await host.getByRole('navigation',{name:'文档索引'}).getByRole('button').first().click();await expect(host.locator('canvas').first()).toBeVisible();
  await host.getByRole('tab',{name:'Book 关闭 Book'}).click({button:'right'});
  await host.getByRole('menuitem',{name:'在 Finder 中打开',exact:true}).click();
  expect(await page.evaluate(()=>(window as any).nativeReveals)).toEqual([configPath,folder]);
  await page.screenshot({path:testInfo.outputPath('status-groups-pdf.png')});
});

test('multiple PDFs share a continuous scroll, generated index, bookmarks and a bounded canvas window', async ({page},testInfo)=>{
  const folder='化学/课件',pdf=makePdfFixture({pages:40});
  const files=Array.from({length:8},(_,i)=>({path:`${folder}/课件 第${i+1}章.pdf`,title:`课件 ${i+1}`,kind:'pdf',size:pdf.length,headings:[]}));
  const collection={path:folder,title:'物理化学 课件',revision:'pdf-v1',streams:[{id:'pdf',title:'PDF',files}]};
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/api/vault-identity'||url.pathname==='/api/writing')return route.fallback();
    if(url.pathname==='/api/files/content')return route.fulfill({contentType:'application/pdf',body:pdf});
    if(url.pathname.replace(/\/$/,'')==='/api/uistate')return route.fulfill({json:{}});
    return route.fulfill({json:{hits:[],matches:[],backlinks:[],types:{},enabled:false}});
  });
  await page.goto('/__render-test');await page.waitForFunction(()=>!!window.renderHarness);
  await page.evaluate(async({folder,collection})=>{
    const load=(path:string)=>import(path);
    const [React,ReactDOM,{default:Workspace},{default:RightSidebar},store]=await Promise.all([
      load('/node_modules/.vite/deps/react.js'),load('/node_modules/.vite/deps/react-dom_client.js'),load('/src/components/Workspace.tsx'),load('/src/components/RightSidebar.tsx'),load('/src/lib/store.ts')]);
    document.getElementById('root')!.hidden=true;const host=document.createElement('div');host.id='virtual-pdf-fixture';host.style.cssText='position:fixed;inset:0';document.body.append(host);
    await store.useStore.getState().loadUiState();
    store.useStore.setState({tree:{name:'Fixture',path:'',type:'folder',children:[{name:collection.title,path:folder,type:'folder',virtualDocument:collection}]},rightOpen:true,rightPanel:'outline',rightTabs:[],rightActiveId:null});
    await store.useStore.getState().openFile(folder);
    const h=(React.default??React).createElement;(ReactDOM.createRoot??ReactDOM.default.createRoot)(host).render(h('div',{className:'app theme-dark'},h(Workspace),h(RightSidebar,{open:true})));
  },{folder,collection});
  const host=page.locator('#virtual-pdf-fixture');
  await expect(host.getByRole('navigation',{name:'文档索引'})).toBeVisible();
  await host.getByRole('navigation',{name:'文档索引'}).getByRole('button',{name:'课件 7',exact:true}).click();
  const source=host.locator('[data-virtual-source]').nth(6);
  await expect(source.locator('canvas').first()).toBeVisible();
  await expect.poll(()=>host.locator('canvas').count()).toBeLessThan(15);
  await expect.poll(()=>host.locator('[data-mounted="true"]').count()).toBeLessThanOrEqual(6);
  const outline=host.getByRole('navigation',{name:'连续文档大纲'});
  await expect(outline.getByRole('button',{name:'Chapter Two',exact:true}).last()).toBeAttached();
  await outline.locator('section').filter({has:page.getByRole('button',{name:'课件 7',exact:true})})
    .getByRole('button',{name:'Chapter Two',exact:true}).click();
  await expect(source.locator('[data-page-number="2"] .pdf-page-surface')).toBeInViewport();
  await expect(source.locator('[data-page-number="2"] .pdf-page-surface')).toHaveClass(/is-ready/);
  await source.locator('[data-page-number="30"]').evaluate(element=>element.scrollIntoView({block:'start'}));
  await expect(source.locator('[data-page-number="30"] canvas')).toBeVisible();
  await expect(source.locator('[data-page-number="30"] .pdf-page-surface')).toHaveClass(/is-ready/);
  await expect.poll(()=>host.locator('canvas').count()).toBeLessThan(15);
  await testInfo.attach('pdf-window.json',{body:JSON.stringify({sources:files.length,pages:files.length*40,canvases:await host.locator('canvas').count(),mounted:await host.locator('[data-mounted="true"]').count()}),contentType:'application/json'});
  const geometry=await source.locator('[data-page-number="30"] .pdf-page-surface').evaluate(surface=>{
    const root=surface.closest('.virtual-document-scroll')!;const bounds=root.getBoundingClientRect(),style=getComputedStyle(root),page=surface.getBoundingClientRect();
    return {left:page.left,right:page.right,contentLeft:bounds.left+parseFloat(style.paddingLeft),contentRight:bounds.right-parseFloat(style.paddingRight)};
  });
  expect(geometry.left).toBeGreaterThanOrEqual(geometry.contentLeft);expect(geometry.right).toBeLessThanOrEqual(geometry.contentRight+1);
  await page.screenshot({path:testInfo.outputPath('virtual-pdf-pages.png')});
  await page.setViewportSize({width:420,height:850});
  await expect(host.getByRole('button',{name:'切换分组：PDF',exact:true})).toBeVisible();
});
