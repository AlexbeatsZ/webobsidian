import { app, BrowserWindow, Menu, dialog, ipcMain, net, shell, type IpcMainEvent, type IpcMainInvokeEvent, type MenuItemConstructorOptions } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { UserscriptService } from './userscripts/service';
import { effectiveVaultPath, openExistingPath } from './paths';

// ---------------------------------------------------------------------------
// Paths & persisted desktop config
// ---------------------------------------------------------------------------
// Everything user-specific lives under Electron's per-user userData dir:
//   <userData>/desktop-config.json  — { vaultPath, secret, dataDir }
//   <userData>/server-data/         — the server's DATA_DIR (settings.json, index)
//   <userData>/logs/server.log      — server child stdout/stderr (debugging)
const CONFIG_FILE = () => path.join(app.getPath('userData'), 'desktop-config.json');
const DATA_DIR = () => path.join(app.getPath('userData'), 'server-data');
const LOG_FILE = () => path.join(app.getPath('userData'), 'logs', 'server.log');
// Cold starts rebuild the Vault index before opening the HTTP listener.
const SERVER_STARTUP_TIMEOUT_MS = 120_000;

interface DesktopConfig {
  vaultPath?: string;
  trustedPlugins?: boolean;
}

let serverProc: ChildProcess | null = null;
let serverPort = 0;
let mainWindow: BrowserWindow | null = null;
let desktopConfig: DesktopConfig | undefined;
let userscripts: UserscriptService | undefined;

async function readConfig(): Promise<DesktopConfig> {
  try {
    const raw = await fs.readFile(CONFIG_FILE(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<DesktopConfig>;
    if (parsed && typeof parsed === 'object') {
      return parsed as DesktopConfig;
    }
  } catch {
    /* first run / corrupt — fall through to fresh config */
  }
  return {};
}

async function writeConfig(cfg: DesktopConfig): Promise<void> {
  await fs.mkdir(path.dirname(CONFIG_FILE()), { recursive: true });
  await fs.writeFile(CONFIG_FILE(), JSON.stringify(cfg, null, 2), 'utf8');
}

// ---------------------------------------------------------------------------
// Server entry / runtime layout
// ---------------------------------------------------------------------------
// Packaged: extraResources puts the bundle at <resources>/server/dist/index.mjs.
// Dev (electron dist/main.js): it lives at <desktop>/.gen/server/dist/index.mjs.
function serverEntry(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'server', 'dist', 'index.mjs');
  }
  return path.join(__dirname, '..', '.gen', 'server', 'dist', 'index.mjs');
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

// GUI-launched apps (esp. macOS Finder) inherit a minimal PATH, so `git` (needed
// by the optional vault-sync feature) is often not found. Prepend the usual spots.
function augmentedPath(): string {
  const extra = ['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
  const current = process.env.PATH ?? '';
  const parts = current.split(path.delimiter).filter(Boolean);
  for (const p of extra) if (!parts.includes(p)) parts.push(p);
  return parts.join(path.delimiter);
}

async function startServer(cfg: DesktopConfig): Promise<void> {
  serverPort = await freePort();
  await fs.mkdir(DATA_DIR(), { recursive: true });
  await fs.mkdir(path.dirname(LOG_FILE()), { recursive: true });

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: String(serverPort),
    DATA_DIR: DATA_DIR(),
    VAULT_PATH: cfg.vaultPath,
    // Let the in-app folder browser roam the user's home (single-user desktop).
    ALLOWED_ROOTS: os.homedir(),
    PATH: augmentedPath(),
  };

  // Run the bundled server with Electron's own Node (no external node needed).
  const log = (await fs.open(LOG_FILE(), 'a')).createWriteStream();
  const startedAt = Date.now();
  log.write(`\n[desktop] starting server at ${new Date(startedAt).toISOString()} (port=${serverPort}, timeout=${SERVER_STARTUP_TIMEOUT_MS}ms)\n`);
  const child = spawn(process.execPath, [serverEntry()], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  serverProc = child;
  let startupError: Error | undefined;

  child.stdout?.pipe(log, { end: false });
  child.stderr?.pipe(log, { end: false });
  child.on('error', (err) => {
    startupError = new Error(`Could not start the server: ${err.message}\nServer log: ${LOG_FILE()}`);
  });
  child.on('exit', (code, signal) => {
    if (!app.isPackaged) console.error(`[server] exited code=${code} signal=${signal}`);
    if (serverProc === child) serverProc = null;
  });
  child.on('close', (code, signal) => {
    // Finish both output streams before reporting a startup failure so the log
    // is available even when the app immediately closes the error dialog.
    log.end(() => {
      startupError ??= new Error(`Server exited before becoming healthy (code=${code}, signal=${signal}).\nServer log: ${LOG_FILE()}`);
    });
  });

  await waitForHealth(serverPort, () => startupError);
  log.write(`[desktop] server healthy after ${Date.now() - startedAt}ms\n`);
}

function baseUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForHealth(port: number, failure: () => Error | undefined): Promise<void> {
  const deadline = Date.now() + SERVER_STARTUP_TIMEOUT_MS;
  for (;;) {
    const startupError = failure();
    if (startupError) throw startupError;
    try {
      const res = await apiRequest('GET', `${baseUrl(port)}/healthz`);
      if (res.status === 200) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw failure() ?? new Error(`Server did not become healthy within ${SERVER_STARTUP_TIMEOUT_MS / 1000} seconds.\nServer log: ${LOG_FILE()}`);
    await delay(250);
  }
}

interface ApiResult {
  status: number;
  json: unknown;
}

function apiRequest(
  method: string,
  url: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<ApiResult> {
  return new Promise((resolve, reject) => {
    const req = net.request({ method, url });
    if (body !== undefined) req.setHeader('Content-Type', 'application/json');
    for (const [k, v] of Object.entries(headers ?? {})) req.setHeader(k, v);
    let data = '';
    req.on('response', (res) => {
      res.on('data', (chunk) => (data += chunk.toString()));
      res.on('end', () => {
        let json: unknown = null;
        try {
          json = data ? JSON.parse(data) : null;
        } catch {
          json = null;
        }
        resolve({ status: res.statusCode ?? 0, json });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Vault selection
// ---------------------------------------------------------------------------
async function ensureVault(cfg: DesktopConfig): Promise<DesktopConfig> {
  if (cfg.vaultPath) {
    try {
      const st = await fs.stat(cfg.vaultPath);
      if (st.isDirectory()) return cfg;
    } catch {
      /* configured vault vanished — re-pick */
    }
  }
  const picked = await pickVaultDialog(true);
  cfg.vaultPath = picked;
  await writeConfig(cfg);
  await userscripts?.stop();
  return cfg;
}

// Prompt for a folder. On first run (no window yet) we also offer a sensible
// default so the user can get going with one click.
async function pickVaultDialog(firstRun: boolean): Promise<string> {
  const result = await dialog.showOpenDialog({
    title: "选择仓库文件夹",
    message: '选择用作 WebObsidian 仓库的文件夹',
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: '使用此文件夹',
  });
  if (!result.canceled && result.filePaths[0]) return result.filePaths[0];

  // Cancelled: fall back to (and create) a default vault under Documents.
  const fallback = path.join(app.getPath('documents'), 'WebObsidianVault');
  await fs.mkdir(fallback, { recursive: true });
  if (firstRun) {
    await dialog.showMessageBox({
      type: 'info',
      message: '将使用默认仓库',
      detail: `未选择文件夹 — 笔记将保存在：\n${fallback}\n\n之后可在菜单中切换仓库。`,
      buttons: ['确定'],
    });
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Window + menu
// ---------------------------------------------------------------------------
function createWindow(starting = false): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 480,
    backgroundColor: '#1e1e1e',
    title: 'WebObsidian',
    icon: app.isPackaged ? undefined : path.join(__dirname, '..', 'buildResources', 'icon.png'),
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin' ? {
      trafficLightPosition: { x: 12, y: 9 },
    } : {
      titleBarOverlay: { color: starting ? '#1e1e1e' : '#f6f6f6', symbolColor: starting ? '#dddddd' : '#333333', height: 32 },
    }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // Native Obsidian plugins have the same machine access as the user.
      // Keep the restricted host by default; trust is a per-install choice.
      contextIsolation: !desktopConfig?.trustedPlugins,
      nodeIntegration: !!desktopConfig?.trustedPlugins,
      sandbox: !desktopConfig?.trustedPlugins,
      webviewTag: true,
      additionalArguments: desktopConfig?.trustedPlugins ? [`--webobsidian-native-vault=${encodeURIComponent(desktopConfig.vaultPath ?? '')}`] : [],
    },
  });

  // Retain native actions/accelerators behind F10, without a visible menu row.
  if (process.platform !== 'darwin') mainWindow.setMenuBarVisibility(false);

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const target = new URL(url);
    if (target.origin !== baseUrl(serverPort) || !(target.pathname === '/' || target.pathname.startsWith('/note/'))) {
      event.preventDefault(); if (/^https?:/.test(url)) void shell.openExternal(url);
    }
  });
  mainWindow.webContents.on('will-redirect', (event, url) => {
    const target = new URL(url);
    if (target.origin !== baseUrl(serverPort) || !(target.pathname === '/' || target.pathname.startsWith('/note/'))) event.preventDefault();
  });
  mainWindow.webContents.on('will-attach-webview', (event, preferences, params) => {
    if (!/^https?:\/\//i.test(params.src)) { event.preventDefault(); return; }
    // Only our bundled sandbox preload may enter remote guests. No host Node.
    preferences.preload = path.join(__dirname, 'preload.js');
    preferences.additionalArguments = ['--webobsidian-userscript-guest'];
    preferences.nodeIntegration = false; preferences.contextIsolation = true; preferences.sandbox = true;
    preferences.nodeIntegrationInSubFrames = false;
    preferences.nodeIntegrationInWorker = false;
    preferences.webviewTag = false;
    preferences.webSecurity = true;
    preferences.allowRunningInsecureContent = false;
  });
  mainWindow.webContents.on('did-attach-webview', (_event, contents) => userscripts?.attach(contents));

  // Open external links (http/https not on our origin) in the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  const syncFullscreen = () => mainWindow?.webContents.send('desktop:fullscreen', mainWindow.isFullScreen());
  mainWindow.on('enter-full-screen', syncFullscreen);
  mainWindow.on('leave-full-screen', syncFullscreen);
  mainWindow.webContents.on('did-finish-load', syncFullscreen);
  mainWindow.on('maximize', () => mainWindow?.webContents.send('desktop:fullscreen', mainWindow.isFullScreen()));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Show a real window before cold Vault indexing. A second click must focus
  // this window rather than looking as though the first launch did nothing.
  void mainWindow.loadURL(starting ? `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>WebObsidian</title>
<style>html{color-scheme:dark}body{margin:0;background:#1e1e1e;color:#ddd;font:15px system-ui;display:grid;place-content:center;height:100vh;text-align:center}.drag{-webkit-app-region:drag;position:fixed;inset:0 140px auto 0;height:32px}p{color:#aaa;font-size:13px}.spinner{margin:0 auto 20px;width:28px;height:28px;border:3px solid #444;border-top-color:#b9a3e3;border-radius:50%;animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}</style></head>
<body><div class="drag"></div><div class="spinner"></div><div role="status">正在打开笔记库</div><p>正在准备本地服务与索引，首次打开可能需要一些时间。</p></body></html>`)}` : baseUrl(serverPort));
}

async function switchVault(): Promise<void> {
  const cfg = await readConfig();
  const picked = await pickVaultDialog(false);
  if (picked === cfg.vaultPath) return;
  cfg.vaultPath = picked;
  await writeConfig(cfg);
  // Restart cleanly so the server re-indexes against the new vault.
  app.relaunch();
  app.exit(0);
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin';
  // Native menus dispatch the same registered commands as the palette/hotkeys.
  const command = (id: string) => () => mainWindow?.webContents.send('desktop:command', id);
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ label: 'WebObsidian', submenu: [
      { role: 'about' as const, label: '关于 WebObsidian' },
      { type: 'separator' as const },
      { label: '设置…', accelerator: 'Command+,', click: command('settings') },
      { type: 'separator' as const },
      { role: 'services' as const, label: '服务' },
      { type: 'separator' as const },
      { role: 'hide' as const, label: '隐藏 WebObsidian' },
      { role: 'hideOthers' as const, label: '隐藏其他' },
      { role: 'unhide' as const, label: '全部显示' },
      { type: 'separator' as const },
      { role: 'quit' as const, label: '退出 WebObsidian' },
    ] }] : []),
    {
      label: "文件",
      submenu: [
        { label: '新建笔记', accelerator: 'CommandOrControl+N', click: command('new') },
        { label: '打开笔记…', accelerator: 'CommandOrControl+O', click: command('files') },
        { label: '保存', accelerator: 'CommandOrControl+S', click: command('save') },
        { type: 'separator' },
        { label: "信任原生插件 (下次启动生效)", type: 'checkbox', checked: !!desktopConfig?.trustedPlugins,
          click: async (item) => { const cfg = await readConfig(); cfg.trustedPlugins = item.checked; await writeConfig(cfg); } },
        { label: "切换仓库…", click: () => void switchVault() },
        {
          label: "打开仓库文件夹",
          click: async () => {
            try { await openExistingPath(await effectiveVaultPath(DATA_DIR(), desktopConfig?.vaultPath)); }
            catch (error) { dialog.showErrorBox('无法打开笔记库', String(error)); }
          },
        },
        { type: 'separator' },
        { label: "打开数据文件夹", click: () => shell.openPath(DATA_DIR()) },
        { label: "打开日志", click: () => shell.openPath(LOG_FILE()) },
        { type: 'separator' },
        isMac ? { role: 'close', label: '关闭窗口' } : { role: 'quit', label: '退出' },
      ],
    },
    {
      label: "编辑",
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'pasteAndMatchStyle', label: '粘贴并匹配样式' },
        { role: 'delete', label: '删除' },
        { role: 'selectAll', label: '全选' },
        ...(isMac ? [{ type: 'separator' as const }, { role: 'startSpeaking' as const, label: '开始朗读' },
          { role: 'stopSpeaking' as const, label: '停止朗读' }] : []),
      ],
    },
    {
      label: "显示",
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'forceReload', label: '强制重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '切换全屏' },
      ],
    },
    {
      label: "窗口",
      submenu: [
        { role: 'minimize', label: '最小化' },
        ...(isMac ? [{ role: 'zoom' as const, label: '缩放' }, { role: 'close' as const, label: '关闭窗口' },
          { type: 'separator' as const }, { role: 'front' as const, label: '全部置于顶层' },
          { role: 'window' as const, label: '窗口' }] : [{ role: 'close' as const, label: '关闭窗口' }]),
      ],
    },
    {
      role: 'help',
      submenu: [
        {
          label: "GitHub 上的 WebObsidian",
          click: () => shell.openExternal('https://github.com/xnohat/webobsidian'),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Only the local app's top-level frame may operate native desktop chrome.
function desktopWindow(event: IpcMainEvent | IpcMainInvokeEvent): BrowserWindow | null {
  const frame = event.senderFrame;
  if (!mainWindow || !frame || event.sender !== mainWindow.webContents || frame !== event.sender.mainFrame) return null;
  try {
    return new URL(frame.url).origin === baseUrl(serverPort) ? mainWindow : null;
  } catch {
    return null;
  }
}

function registerTitleBar(): void {
  ipcMain.handle('desktop:open-application-menu', (event) => {
    const win = desktopWindow(event);
    const menu = Menu.getApplicationMenu();
    if (!win || !menu) return;
    return new Promise<void>((resolve) => menu.popup({
      window: win,
      x: 0,
      y: 32,
      callback: resolve,
    }));
  });
  ipcMain.on('desktop:titlebar-theme', (event, dark: boolean) => {
    const win = desktopWindow(event);
    if (win && process.platform !== 'darwin' && typeof dark === 'boolean') win.setTitleBarOverlay({
      color: dark ? '#262626' : '#f6f6f6',
      symbolColor: dark ? '#dadada' : '#333333',
    });
  });
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------
function registerDesktopRequests(): void {
  ipcMain.handle('desktop:open-vault-path', async (event, requested: unknown) => {
    if (!desktopWindow(event)) throw new Error('Local application frame required');
    if (typeof requested !== 'string' || !requested.trim() || requested.length > 32768 || requested.includes('\0')) throw new Error('文件路径无效');
    const location = requested.startsWith('~/') ? path.join(os.homedir(), requested.slice(2)) : requested;
    let target: string;
    if (path.isAbsolute(location)) target = path.normalize(location);
    else {
      const vault = await effectiveVaultPath(DATA_DIR(), desktopConfig?.vaultPath);
      target = path.resolve(vault, location);
      const relative = path.relative(vault, target);
      if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('相对路径必须位于当前笔记库内');
    }
    await openExistingPath(target);
  });
  ipcMain.handle('desktop:plugin-request', async (event, options) => {
    if (!desktopWindow(event) || !desktopConfig?.trustedPlugins) throw new Error('Native plugins are disabled');
    const url = new URL(options.url);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('HTTP(S) URL required');
    const response = await net.fetch(url.href, {method:options.method ?? 'GET',headers:options.headers,body:options.body,signal:AbortSignal.timeout(30000)});
    const headers: Record<string,string> = {}; response.headers.forEach((value,key) => headers[key] = value);
    return {status:response.status,headers,base64:Buffer.from(await response.arrayBuffer()).toString('base64')};
  });
}
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      let cfg = await readConfig();
      cfg = await ensureVault(cfg);
      desktopConfig = cfg;
      await writeConfig(cfg); // persist freshly-generated secret on first run
      createWindow(true);
      await startServer(cfg);
      if (!mainWindow || mainWindow.isDestroyed()) return;
      buildMenu();
      registerTitleBar();
      registerDesktopRequests();
      userscripts = new UserscriptService({ dataDir: DATA_DIR(), fallbackVault: cfg.vaultPath!,
        window: () => mainWindow, hostAllowed: event => !!desktopWindow(event) });
      await userscripts.start();
      if (mainWindow && !mainWindow.isDestroyed()) await mainWindow.loadURL(baseUrl(serverPort));
    } catch (err) {
      dialog.showErrorBox('WebObsidian failed to start', String(err instanceof Error ? err.stack ?? err.message : err));
      app.quit();
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0 && serverPort) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  let finishingQuit = false;
  app.on('before-quit', (event) => {
    if (!finishingQuit && userscripts) {
      event.preventDefault(); finishingQuit = true;
      void userscripts.stop().catch(error => console.error('Userscript shutdown:', error)).finally(() => app.quit());
      return;
    }
    if (serverProc) {
      serverProc.kill();
      serverProc = null;
    }
  });
}
