import type { UserscriptBridge } from './userscripts/types';
import type { McpLauncherState } from '../../../desktop/src/mcpLauncher';

declare global {
  interface Window {
    webobsidianDesktop?: {
      isDesktop: boolean;
      platform: string;
      nativePlugins: boolean;
      mcp?: {
        inspect(): Promise<McpLauncherState>;
        selectProject(): Promise<McpLauncherState | null>;
        connect(): Promise<McpLauncherState>;
      };
      vaultPath?: string;
      openVaultPath(path: string): Promise<void>;
      onBeforeClose(listener: () => Promise<void>): () => void;
      userscripts: UserscriptBridge;
      webviewer: {
        subscribe(listener: (page: { sourceGuestId: number; url: string }) => void): () => void;
      };
    };
  }
}
