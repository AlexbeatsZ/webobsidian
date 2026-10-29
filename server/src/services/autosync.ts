import { getSettings } from './settings.js';
import { sync } from './git.js';
import { fileSyncPreferences } from './fileSyncPreferences.js';

/** Periodic auto-sync when enabled in settings (PRD FR-4). */
let timer: NodeJS.Timeout | null = null;
let running = false;

export function startAutoSync(): void {
  if (timer) clearInterval(timer);
  // Re-evaluate settings each tick so toggling takes effect without restart.
  timer = setInterval(tick, 30_000);
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const s = await getSettings();
    if (!s.git.enabled || !s.git.autoSync) return;
    const native = (await fileSyncPreferences()).enabled;
    if (!s.git.remote && !native) return;
    const intervalMs = Math.max(s.git.intervalSec, 60) * 1000;
    if (Date.now() - (lastRun ?? 0) < intervalMs) return;
    const res = await sync();
    lastRun = Date.now();
    if (res.ok) console.log('[autosync] ok:', res.log.join(' | '));
    else console.warn('[autosync] not-ok:', res.log.join(' | '));
  } catch (e: any) {
    console.warn('[autosync] failed:', e.message);
  } finally {
    running = false;
  }
}

let lastRun: number | null = null;
