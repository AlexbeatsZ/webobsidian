import type { DesktopBridge } from '../../../desktop/src/bridge';

declare global {
  interface Window { webobsidianDesktop?: DesktopBridge }
}
