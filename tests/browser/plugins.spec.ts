import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { createServer } from 'node:http';

const fixtureCode = `
const {Plugin,PluginSettingTab,Setting,MarkdownRenderChild} = require('obsidian');
const {EditorView} = require('@codemirror/view');
module.exports = class extends Plugin {
 async onload() {
  this.data = await this.loadData() || {value:'old'};
  this.addCommand({id:'append',name:'Append fixture',hotkeys:[{modifiers:['Mod','Alt'],key:'k'}],editorCallback:ed=>ed.replaceSelection('PLUGIN')});
  this.addCommand({id:'save-setting',name:'Save fixture setting',callback:()=>this.saveData({value:'saved'})});
  const plugin=this;
  this.addSettingTab(new class extends PluginSettingTab { display() { this.containerEl.empty(); new Setting(this.containerEl).setName('Fixture value').addText(text=>text.setValue(plugin.data.value).onChange(value=>{plugin.data.value=value;plugin.saveData(plugin.data);})); } }(this.app,this));
  this.registerEditorExtension(EditorView.updateListener.of(u=>{if(u.docChanged)window.fixtureChanges=(window.fixtureChanges||0)+1}));
  this.registerMarkdownCodeBlockProcessor('fixture',(source,el,ctx)=>{el.textContent='RESULT:'+source.trim();const child=new MarkdownRenderChild(el);child.onunload=()=>window.fixtureChildUnloaded=true;ctx.addChild(child)});
  this.registerEvent(this.app.vault.on('fixture',()=>window.fixtureEvents=(window.fixtureEvents||0)+1));
  this.registerInterval(setInterval(()=>window.fixtureTicks=(window.fixtureTicks||0)+1,20));
 }
};`;
async function setup(
  page: any,
  entries: any[],
  raw = '# Fixture\n\nplain\n\n```fixture\nhello\n```\n\nend',
  data: Record<string, any> = {},
  extras: Record<string, string> = {}
) {
  const contents: Record<string, string> = {
    'fixture.md': raw,
    'other.md': '---\ntags: [test]\n---\n# Other\n[[fixture]]',
    ...extras,
  };
  await page.route('**/api/**', async (route: any) => {
    const request = route.request(),
      url = new URL(request.url()),
      body = request.postDataJSON?.();
    const json = (value: any) => route.fulfill({ json: value });
    if (url.pathname === '/api/plugins/')
      return json({ plugins: entries.map(({ code, ...m }) => m) });
    if (url.pathname.endsWith('/main.js')) {
      const id = url.pathname.split('/')[3];
      return route.fulfill({
        contentType: 'application/javascript',
        body: entries.find((e) => e.id === id)?.code ?? '',
      });
    }
    if (url.pathname.endsWith('/data')) {
      const id = url.pathname.split('/')[3];
      if (request.method() === 'PUT') data[id] = body.data;
      return json({ data: data[id] ?? null });
    }
    if (url.pathname.endsWith('/enabled')) return json({ ok: true });
    if (url.pathname === '/api/files/')
      return json({
        name: 'Plugin Fixture',
        path: '',
        type: 'folder',
        children: Object.keys(contents).map((p) => ({
          name: p,
          path: p,
          type: 'file',
          mtime: 1,
          ctime: 1,
          size: contents[p].length,
        })),
      });
    if (url.pathname === '/api/files/content') {
      if (request.method() === 'PUT') {
        contents[body.path] = body.content;
        return json({ ok: true, revision: 'updated' });
      }
      const p = url.searchParams.get('path');
      if (url.searchParams.get('raw') === '1')
        return route.fulfill({
          body: contents[p!] ?? '',
          contentType: 'text/plain',
        });
      return json({
        path: p,
        content: contents[p!] ?? '',
        revision: 'initial',
      });
    }
    if (url.pathname === '/api/plugins/adapter') {
      if (body.op === 'exists') return json({ exists: body.path in contents });
      if (body.op === 'read')
        return body.path in contents
          ? json({ content: contents[body.path] })
          : route.fulfill({ status: 404, json: { error: 'not found' } });
      if (body.op === 'list')
        return json({ files: Object.keys(contents), folders: [] });
      return json({ ok: true });
    }
    if (url.pathname === '/api/settings/')
      return json({ vault: { path: 'fixture' }, ui: {}, plugins: {} });
    if (url.pathname === '/api/property-types') return json({ types: {} });
    if (url.pathname === '/api/tags') return json({ tags: [] });
    if (url.pathname === '/api/properties') return json({ properties: [] });
    return json({});
  });
  await page.goto('http://127.0.0.1:5179/__plugin-test');
  await page.waitForSelector('[data-plugin-ready="true"]');
  await page.waitForSelector('.cm-content');
  return { data, contents };
}
test('real command, settings, metadata, CM extension, fenced renderer and unload', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const { data } = await setup(page, [
    {
      id: 'fixture',
      name: 'Fixture Plugin',
      version: '1.0',
      enabled: true,
      code: fixtureCode,
    },
  ]);
  await expect(page.locator('.plugin-code-block')).toContainText(
    'RESULT:hello'
  );
  expect(
    await page.evaluate(() => [
      ...(window as any).pluginHarness.pluginStatuses.values(),
    ])
  ).toEqual([{ id: 'fixture', state: 'loaded' }]);
  await page.locator('.cm-content').click();
  await page.evaluate(() => {
    const h = (window as any).pluginHarness;
    const ed = h.sharedApp.workspace.getActiveViewOfType(
      h.obsidianModule.MarkdownView
    ).editor;
    ed.setCursor(2, 0);
    h.runPluginCommand('fixture:append');
  });
  await expect(page.locator('.cm-content')).toContainText('PLUGINplain');
  expect(
    await page.evaluate(() => (window as any).fixtureChanges)
  ).toBeGreaterThan(0);
  await page.evaluate(() => {
    const h = (window as any).pluginHarness;
    h.store.getState().setPalette(true, 'commands');
  });
  await expect(
    page
      .locator('.palette-item')
      .filter({ hasText: 'Fixture Plugin: Append fixture' })
  ).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const h = (window as any).pluginHarness;
    h.openPluginSettings('fixture');
  });
  await expect(page.locator('.setting-item-name')).toContainText(
    'Fixture value'
  );
  await page.locator('.setting-item input').fill('persisted');
  await expect.poll(() => data.fixture?.value).toBe('persisted');
  const metadata = await page.evaluate(() => {
    const h = (window as any).pluginHarness;
    return h.sharedApp.metadataCache.getCache('other.md');
  });
  expect(metadata.frontmatter.tags).toEqual(['test']);
  expect(metadata.headings[0].heading).toBe('Other');
  await page.evaluate(() => {
    const h = (window as any).pluginHarness;
    h.sharedApp.vault.trigger('fixture');
    h.unloadPlugin('fixture');
    h.sharedApp.vault.trigger('fixture');
  });
  expect(await page.evaluate(() => (window as any).fixtureEvents)).toBe(1);
  expect(await page.evaluate(() => (window as any).fixtureChildUnloaded)).toBe(
    true
  );
  await expect(page.locator('.plugin-code-block')).toHaveCount(0);
  expect(
    await page.evaluate(() => [
      ...(window as any).pluginHarness.pluginCommands.keys(),
    ])
  ).toEqual([]);
  expect(errors).toEqual([]);
});

test('current original plugins load against the host', async ({ page }) => {
  test.skip(
    !process.env.OBSIDIAN_PLUGIN_VAULTS,
    'Set OBSIDIAN_PLUGIN_VAULTS to read-only source vaults for original-plugin acceptance'
  );
  test.setTimeout(120000);
  const inventory: any[] = [];
  for (const vault of process.env.OBSIDIAN_PLUGIN_VAULTS!.split(';')) {
    const dir = path.join(vault, '.obsidian'),
      ids = JSON.parse(
        await fs.readFile(path.join(dir, 'community-plugins.json'), 'utf8')
      );
    const entries = [],
      data: Record<string, any> = {},
      extras: Record<string, string> = {};
    for (const id of ids) {
      try {
        const base = path.join(dir, 'plugins', id);
        const manifest = JSON.parse(
          await fs.readFile(path.join(base, 'manifest.json'), 'utf8')
        );
        entries.push({
          ...manifest,
          enabled: true,
          code: await fs.readFile(path.join(base, 'main.js'), 'utf8'),
        });
        try {
          data[id] = JSON.parse(
            await fs.readFile(path.join(base, 'data.json'), 'utf8')
          );
        } catch {}
      } catch {
        inventory.push({ vault: path.basename(vault), id, state: 'missing' });
      }
    }
    const snippets = data['obsidian-latex-suite']?.snippetsFileLocation;
    if (snippets)
      extras[snippets] = await fs.readFile(path.join(vault, snippets), 'utf8');
    // Fixtures intentionally have no user scripts or startup templates.
    if (data['templater-obsidian'])
      Object.assign(data['templater-obsidian'], {
        user_scripts_folder: '',
        startup_templates: [],
        enable_system_commands: false,
      });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const logs: string[] = [];
    const log = async (m: any) => {
      if (m.type() === 'error') {
        logs.push(m.text().slice(0, 900));
        for (const arg of m.args()) {
          const stack = await arg
            .evaluate((v: any) => v?.stack)
            .catch(() => null);
          if (stack) logs.push(stack.slice(0, 1400));
        }
      }
    };
    page.on('console', log);
    await setup(
      page,
      entries,
      '# Fixture\n\nordinary $x^2$.\n\n```dataview\nLIST file.name FROM "" WHERE file.name = "other"\n```\n\n```js\n// @obsidian-js\ncontainer.createEl("p",{text:"INTERACTIVE:"+sourcePath});\n```\n\n```js\nwindow.passiveShouldNotRun=true;\n```\n\nend',
      data,
      extras
    );
    await page.waitForTimeout(1500);
    const statuses = await page.evaluate(() => [
      ...(window as any).pluginHarness.pluginStatuses.values(),
    ]);
    await expect(page.locator('.interactive-js-render')).toContainText(
      'INTERACTIVE:fixture.md'
    );
    expect(
      await page.evaluate(() => (window as any).passiveShouldNotRun)
    ).toBeUndefined();
    if (path.basename(vault) === 'Manage')
      await expect(page.locator('.block-language-dataview')).toContainText(
        'other'
      );
    const settingsErrors = await page.evaluate(() => {
      const out: any[] = [];
      for (const [id, tab] of (window as any).pluginHarness.pluginTabs) {
        try {
          tab.display();
          tab.hide();
        } catch (e) {
          out.push({ id, error: (e as Error).stack });
        }
      }
      return out;
    });
    const behavior = await page.evaluate(async () => {
      const h = (window as any).pluginHarness,
        plugins = h.sharedApp.plugins.plugins;
      const out: any = {};
      const templater = plugins['templater-obsidian']?.templater;
      if (templater) {
        try {
          const file = h.sharedApp.vault.getFileByPath('fixture.md');
          out.template = await templater.parse_template(
            templater.create_running_config(file, file, 1),
            'Value <% 2+3 %>'
          );
        } catch (e) {
          out.templateError = String(e);
        }
      }
      const dv = plugins.dataview?.api;
      if (dv) {
        try {
          out.pages = dv.pages().length;
        } catch (e) {
          out.dataviewError = String(e);
        }
      }
      return out;
    });
    await page.evaluate(() => {
      const h = (window as any).pluginHarness,
        ed = h.sharedApp.workspace.getActiveViewOfType(
          h.obsidianModule.MarkdownView
        ).editor;
      const last = ed.lastLine();
      ed.replaceRange('\n', { line: last, ch: ed.getLine(last).length });
      ed.setCursor(last + 1, 0);
      ed.focus();
    });
    await page.keyboard.type('mk');
    // updateOptions reconfiguration was corrected after the last runtime run.
    // Kept as an explicit regression for the user's unified acceptance run.
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as any).pluginHarness.documents.get('fixture.md').snapshot
              .text
        )
      )
      .toContain('$?');
    inventory.push({
      vault: path.basename(vault),
      statuses,
      errors,
      logs,
      settingsErrors,
      behavior,
    });
    page.off('console', log);
    await page.unroute('**/api/**');
  }
  console.log(JSON.stringify(inventory, null, 2));
  expect(inventory.filter((i) => i.errors?.length)).toEqual([]);
  expect(
    inventory
      .flatMap((i) => i.statuses ?? [])
      .filter((s) => s.state === 'loading' || s.state === 'error')
  ).toEqual([]);
  expect(inventory.flatMap((i) => i.settingsErrors ?? [])).toEqual([]);
  for (const item of inventory.filter((i) => i.behavior)) {
    expect(item.behavior.templateError).toBeUndefined();
    expect(item.behavior.template).toBe('Value 5');
    if (item.vault === 'Manage')
      expect(item.behavior.pages).toBeGreaterThanOrEqual(2);
  }
});

test('native original plugins use isolated Node filesystem and MCP runtime', async () => {
  test.skip(
    !process.env.OBSIDIAN_PLUGIN_VAULTS,
    'Original native plugin sources are opt-in'
  );
  test.setTimeout(120000);
  const require = createRequire(path.resolve('package.json')),
    base = path.join(os.tmpdir(), '.agents');
  await fs.mkdir(base, { recursive: true });
  const temp = await fs.mkdtemp(path.join(base, 'meta-obsidian-native-')),
    vault = path.join(temp, 'vault'),
    project = path.join(temp, 'context-project');
  await fs.mkdir(vault);
  await fs.mkdir(path.join(project, '.local'), { recursive: true });
  await fs.writeFile(path.join(vault, 'fixture.md'), '# Fixture\n\nplain');
  await fs.writeFile(path.join(vault, 'other.md'), '# Other');
  await fs.writeFile(
    path.join(project, '.local', 'config.json'),
    JSON.stringify({ vault: 'plugin-fixture', root: vault })
  );
  await build({
    entryPoints: [path.resolve('desktop/src/preload.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
    outfile: path.join(temp, 'preload.cjs'),
  });
  const main = path.join(temp, 'main.cjs');
  await fs.writeFile(
    main,
    `const {app,BrowserWindow,ipcMain}=require('electron');app.setPath('userData',${JSON.stringify(path.join(temp, 'profile'))});app.whenReady().then(()=>{ipcMain.handle('desktop:menu-items',()=>[]);const win=new BrowserWindow({show:false,webPreferences:{preload:${JSON.stringify(path.join(temp, 'preload.cjs'))},contextIsolation:false,nodeIntegration:true,sandbox:false,webviewTag:true,additionalArguments:[${JSON.stringify('--webobsidian-native-vault=' + encodeURIComponent(vault))}]}});win.loadURL('about:blank')});app.on('window-all-closed',()=>app.quit());`
  );
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [main],
  });
  const guest = createServer((_req, res) =>
    res.end(
      '<!doctype html><title>Isolated guest</title><body>Userscript fixture</body>'
    )
  );
  await new Promise<void>((resolve) => guest.listen(0, '127.0.0.1', resolve));
  const guestUrl = `http://127.0.0.1:${(guest.address() as any).port}/`;
  try {
    const page = await app.firstWindow();
    const errors: string[] = [],
      logs: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') logs.push(m.text().slice(0, 1200));
    });
    await page.addInitScript(
      ({ vault, project }) => {
        if (location.origin !== 'null')
          localStorage.setItem(
            `obsidian:${vault}:obsidian-context-mcp.project`,
            JSON.stringify(project)
          );
      },
      { vault, project }
    );
    const entries = [],
      data: Record<string, any> = {};
    const source = process.env.OBSIDIAN_PLUGIN_VAULTS!.split(';').at(-1)!;
    for (const id of [
      'templater-obsidian',
      'local-latex-renderer',
      'webviewer-userscripts',
      'obsidian-context-mcp',
    ]) {
      const dir = path.join(source, '.obsidian/plugins', id),
        manifest = JSON.parse(
          await fs.readFile(path.join(dir, 'manifest.json'), 'utf8')
        );
      entries.push({
        ...manifest,
        enabled: true,
        code: await fs.readFile(path.join(dir, 'main.js'), 'utf8'),
      });
      if (id === 'local-latex-renderer')
        data[id] = {
          mathJaxPreamble: '',
          cacheFolder: '.obsidian/plugins/local-latex-renderer/cache',
        };
    }
    await setup(page, entries, '# Fixture\n\nplain', data);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as any).pluginHarness.sharedApp.plugins.plugins[
              'obsidian-context-mcp'
            ]?.connected
        )
      )
      .toBe(true);
    const statuses = await page.evaluate(() => [
      ...(window as any).pluginHarness.pluginStatuses.values(),
    ]);
    console.log('native', JSON.stringify({ statuses, errors, logs }));
    expect(statuses.every((s: any) => s.state === 'loaded')).toBe(true);
    expect(errors).toEqual([]);
    expect(logs).toEqual([]);
    const endpoint = JSON.parse(
      await fs.readFile(
        path.join(project, '.local/endpoints/plugin-fixture.json'),
        'utf8'
      )
    );
    const response = await fetch(`http://127.0.0.1:${endpoint.port}/rpc`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + endpoint.token,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: 'obsidian_get_context', arguments: {} }),
    });
    expect(response.ok).toBe(true);
    const context = await response.json();
    expect(context.error).toBeUndefined();
    await page.evaluate(async (url) => {
      const app = (window as any).pluginHarness.sharedApp;
      await (app.plugins.plugins['webviewer-userscripts'] as any).saveScript(
        '// ==UserScript==\n// @name Plugin fixture\n// @namespace webobsidian-test\n// @match http://127.0.0.1/*\n// @grant GM_setValue\n// ==/UserScript==\ndocument.body.dataset.fixture="injected";GM_setValue("fixture","saved");'
      );
      await app.workspace
        .getLeaf(true)
        .setViewState({ type: 'webviewer', state: { url } });
    }, guestUrl);
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const leaf = (
            window as any
          ).pluginHarness.sharedApp.workspace.getLeavesOfType('webviewer')[0];
          try {
            return await leaf.view.webview.executeJavaScript(
              '({injected:document.body.dataset.fixture,node:typeof require})'
            );
          } catch {
            return null;
          }
        })
      )
      .toEqual({ injected: 'injected', node: 'undefined' });
    await expect
      .poll(() =>
        Object.values(data['webviewer-userscripts']?.values ?? {}).some(
          (v: any) => v.fixture === 'saved'
        )
      )
      .toBe(true);
    await page.evaluate(async () => {
      await (window as any).pluginHarness.unloadPlugins();
    });
    await expect
      .poll(() =>
        fs
          .access(path.join(project, '.local/endpoints/plugin-fixture.json'))
          .then(
            () => true,
            () => false
          )
      )
      .toBe(false);
  } finally {
    await app.close();
    await new Promise<void>((resolve) => guest.close(() => resolve()));
    await fs.rm(temp, {
      recursive: true,
      force: true,
      maxRetries: 8,
      retryDelay: 150,
    });
  }
});
