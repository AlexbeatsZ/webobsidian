import { migrateSearchSettings } from './services/searchmigration.js';
import { writingRouter } from './routes/writing.js';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import chokidar from 'chokidar';

import { config } from './config.js';
import { loadSettings, getSettings, updateSettings, ensureVaultBrowsable } from './services/settings.js';
import { errorHandler } from './middleware/error.js';
import { requireLocal, isLocalRequest } from './middleware/localAccess.js';
import { filesRouter } from './routes/files.js';
import { operationsRouter } from './routes/operations.js';
import { bindOperationClient, operationWorkspaceMessage } from './services/operationWorkspace.js';
import { searchRouter } from './routes/search.js';
import { settingsRouter, configureVaultSwitch, assertVaultPathAllowed } from './routes/settings.js';
import { selectVaultWorkspace } from './services/uistate.js';
import { gitRouter } from './routes/git.js';
import { pluginsRouter } from './routes/plugins.js';
import { uiStateRouter } from './routes/uistate.js';
import { configuredMenusRouter } from './routes/configuredMenus.js';
import { tagsRouter } from './routes/tags.js';
import { nativeFeaturesRouter } from './routes/nativeFeatures.js';
import { nativeFeatureSettings } from './services/nativeFeatureSettings.js';
import { configureTagPreferences } from './services/tags/service.js';
import { createAttachmentsRouter } from './routes/attachments.js';
import { AttachmentCleanupService } from './services/attachment-cleanup/service.js';
import { catalog } from './services/catalog.js';
import { guardVaultMutations, bindMaintenanceClients, maintenanceClientConnected,
  maintenanceClientMessage, vaultGeneration, inspectMaintenanceWorkspace,
  assertMaintenanceWorkspaceSafe, withVaultMaintenance, noteVaultMutation } from './services/vaultMaintenance.js';
import { initSearch } from './services/search.js';
import { setBroadcaster, broadcast } from './services/realtime.js';
import { isVaultConfigurationPath } from './services/vaultConfiguration.js';
import { ensureVault } from './services/vault.js';
import { getVaultRoot, clearVaultStats } from './services/vaultFile.js';
import { vaultConfigurationIdentity } from './services/vaultConfiguration.js';
import { asyncHandler } from './middleware/error.js';
import { enableFileUpdates, queueFileUpdate, drainFileUpdates, rebuildFileIndexes } from './services/fileupdates.js';
import { startAutoSync } from './services/autosync.js';
import { fileSyncRouter } from './routes/fileSync.js';
import { startFileSync, recoverFileSync, noteFileSyncChange } from './services/fileSync.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Keep the local server alive on stray async errors (e.g. a deferred library task
// throwing) instead of crashing the whole process — log loudly so bugs aren't hidden.
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

async function main() {
  await loadSettings();
  // A native first-use choice is committed before any index/watcher/client
  // exists. Subsequent selections use the normal settings maintenance path.
  const initialVault = process.env.WEBOBSIDIAN_INITIAL_VAULT;
  if (initialVault) {
    await assertVaultPathAllowed({ path: initialVault, allowedRoots: config.allowedRoots });
    const previous = (await getSettings()).vault.path;
    await updateSettings(draft => {
      draft.vault.path = path.resolve(initialVault);
      draft.vault.allowedRoots = config.allowedRoots;
      ensureVaultBrowsable(draft);
    });
    if (path.resolve(previous) !== path.resolve(initialVault)) await selectVaultWorkspace(previous, initialVault);
  }
  await ensureVault();
  await recoverFileSync();

  const app = express();
  app.use(requireLocal);
  app.use(express.json({ limit: '32mb' }));
  app.use(guardVaultMutations);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          defaultSrc: ["'self'"],
          // Trusted personal plugins share the local application policy.
          scriptSrc: ["'self'", "'unsafe-eval'", 'blob:'],
          workerSrc: ["'self'", 'blob:'],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'", 'ws:', 'wss:'],
          objectSrc: ["'none'"],
          frameSrc: ["'self'", 'blob:'],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: null,
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-origin' },
    }),
  );

  if (!config.isProd) {
    app.use(cors({ origin: 'http://localhost:5173', credentials: true }));
  }

  // Local readiness endpoint for the desktop launcher.
  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  app.get('/api/vault-identity', asyncHandler(async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ vault: (await vaultConfigurationIdentity()).vault });
  }));

  // Specific routes precede the shared search router. Access is checked once above.
  app.use('/api/files', filesRouter);
  app.use('/api/operations', operationsRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/writing', writingRouter);
  app.use('/api/git', gitRouter);
  app.use('/api/file-sync', fileSyncRouter);
  app.use('/api/plugins', pluginsRouter);
  app.use('/api/menus', configuredMenusRouter);
  app.use('/api/tags', tagsRouter);
  app.use('/api/native-features', nativeFeaturesRouter);
  configureTagPreferences(async () => (await nativeFeatureSettings()).tags);
  const attachmentCleanup = new AttachmentCleanupService({
    getCatalog: () => catalog,
    captureState: async () => ({ root: await getVaultRoot(), generation: vaultGeneration(),
      blockers: await inspectMaintenanceWorkspace() }),
    withExclusiveMutation: work => withVaultMaintenance(drainFileUpdates, work),
    assertWorkspaceSafe: assertMaintenanceWorkspaceSafe,
  });
  app.use('/api/attachments', createAttachmentsRouter(attachmentCleanup));
  app.use('/api/uistate', uiStateRouter);
  app.use('/api', searchRouter); // /api/search, /api/tags, /api/backlinks, /api/graph...

  // Static SPA (built into server/public)
  const publicDir = path.join(__dirname, '..', 'public');
  if (await dirExists(publicDir)) {
    app.use(express.static(publicDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api'))
        return next();
      res.sendFile(path.join(publicDir, 'index.html'));
    });
  }

  app.use(errorHandler);

  // Build search index + link graph
  console.log('[boot] indexing vault...');
  await migrateSearchSettings().catch((error) => console.warn('[search migration]', error));
  enableFileUpdates();
  await rebuildFileIndexes(async () => {
    await setupWatcher();
    await initSearch();
  });
  await drainFileUpdates();
  console.log('[boot] index ready');

  const server = http.createServer(app);
  setupWebsocket(server);
  configureVaultSwitch(async commit => {
    const previousWatcher = vaultWatcher;
    vaultWatcher = undefined;
    await previousWatcher?.close();
    await drainFileUpdates();
    await commit();
    await recoverFileSync();
    clearVaultStats();
    await rebuildFileIndexes(async () => {
      await setupWatcher();
      await initSearch();
    });
    await drainFileUpdates();
  });
  startAutoSync();
  startFileSync();

  server.listen(config.port, config.host, () => {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : config.port;
    void fs.writeFile(path.join(config.dataDir, 'operations-endpoint.json'), JSON.stringify({
      protocol: 1, pid: process.pid, url: `http://127.0.0.1:${port}`,
    }), { mode: 0o600 }).catch(error => console.warn('[operations endpoint]', error));
    console.log(`\n  WebObsidian server → http://${config.host}:${config.port}`);
    console.log(`  Vault: ${config.defaultVaultPath}`);
    console.log(`  Data:  ${config.dataDir}\n`);
  });
}

// --- WebSocket: broadcast filesystem & UI-state events to connected clients ----
// HTTP and WebSocket use the same local-request check.
function setupWebsocket(server: http.Server) {
  const wss = new WebSocketServer({ noServer: true });
  bindMaintenanceClients(() => wss.clients);

  server.on('upgrade', (req, socket, head) => {
    let pathname = '';
    try {
      pathname = new URL(req.url ?? '', 'http://localhost').pathname;
    } catch {
      pathname = '';
    }
    if (pathname !== '/ws') {
      socket.destroy();
      return;
    }
    if (!isLocalRequest(req)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (ws) => {
    maintenanceClientConnected();
    bindOperationClient(ws);
    ws.on('message', data => {
      if (!Buffer.isBuffer(data) || data.length > 8 * 1024 * 1024) return;
      try {
        const message = JSON.parse(data.toString());
        if (data.length <= 16384) maintenanceClientMessage(ws, message);
        operationWorkspaceMessage(ws, message);
      } catch { /* invalid or unrelated client message */ }
    });
    ws.send(JSON.stringify({ type: 'hello' }));
  });
  setBroadcaster((msg) => {
    const data = JSON.stringify(msg);
    for (const client of wss.clients) {
      if (client.readyState === 1) client.send(data);
    }
  });
}

// --- chokidar watcher: reflect external changes (git pull, direct edits) ---
let vaultWatcher: ReturnType<typeof chokidar.watch> | undefined;
async function setupWatcher() {
  const root = await getVaultRoot();
  // WEBOBSIDIAN_WATCH: 'auto' (default) = native inotify with automatic polling
  // fallback when the host watch limit is exceeded; 'polling' = force polling.
  const forcePolling = (process.env.WEBOBSIDIAN_WATCH ?? 'auto').toLowerCase() === 'polling';
  await startWatcher(root, forcePolling);
}

function startWatcher(root: string, usePolling: boolean): Promise<void> {
  const watcher = chokidar.watch(root, {
    // Keep Obsidian's frequently rewritten workspace/plugin state ignored.
    // Native configuration alone reuses this watcher without touching note indexes.
    ignored: (p) => {
      const relative = path.relative(root, p).split(path.sep).join('/');
      if (/(^|\/)(\.git|node_modules|\.trash)(\/|$)/.test(relative)) return true;
      if (!relative.split('/').includes('.obsidian')) return false;
      return relative !== '.obsidian' && !isVaultConfigurationPath(relative);
    },
    ignoreInitial: true,
    persistent: true,
    usePolling,
    interval: 1000,
    binaryInterval: 3000,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
  });
  vaultWatcher = watcher;
  let ready = false;
  let resolveReady!: () => void, rejectReady!: (error: unknown) => void;
  const readiness = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  watcher.once('ready', () => { ready = true; resolveReady(); });

  // On a fresh VPS the kernel's `fs.inotify.max_user_watches` is often far below
  // the file count of a large vault, so native watching fails with ENOSPC/EMFILE.
  // Self-heal by transparently switching to polling (no inotify), and tell the
  // operator how to restore native (cheaper) watching.
  let degraded = false;
  watcher.on('error', (err) => {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (!usePolling && !degraded && (code === 'ENOSPC' || code === 'EMFILE')) {
      degraded = true;
      console.warn(
        `[watcher] native file watching hit ${code} (host inotify limit too low ` +
          `for this vault). Falling back to polling. For lower CPU, raise the limit: ` +
          `sudo sysctl -w fs.inotify.max_user_watches=524288`,
      );
      void watcher.close().then(() => {
        if (vaultWatcher !== watcher) throw new Error('Vault watcher was replaced before becoming ready');
        return startWatcher(root, true);
      }).then(resolveReady, error => {
        rejectReady(error);
        if (ready) console.error('[watcher] fallback:', error);
      });
      return;
    }
    console.error('[watcher] error:', err);
    if (!ready) rejectReady(err);
  });

  const onChange = async (absPath: string, type: string) => {
    if (vaultWatcher !== watcher) return;
    const rel = path.relative(root, absPath).split(path.sep).join('/');
    if (isVaultConfigurationPath(rel)) {
      noteFileSyncChange(rel);
      noteVaultMutation();
      broadcast({ type: 'vault-configuration-changed', path: rel, event: type });
      return;
    }
    await queueFileUpdate(rel, type as Parameters<typeof queueFileUpdate>[1]);
  };
  watcher
    .on('add', (p) => onChange(p, 'add'))
    .on('change', (p) => onChange(p, 'change'))
    .on('unlink', (p) => onChange(p, 'unlink'))
    .on('addDir', (p) => onChange(p, 'addDir'))
    .on('unlinkDir', (p) => onChange(p, 'unlinkDir'));
  return readiness;
}

async function dirExists(p: string): Promise<boolean> {
  try {
    const st = await fs.stat(p);
    return st.isDirectory();
  } catch {
    return false;
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
