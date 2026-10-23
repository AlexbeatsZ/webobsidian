import type { UserscriptBridge } from './userscripts/types';

declare global {
  interface Window {
    webobsidianDesktop?: {
      isDesktop: boolean;
      platform: string;
      nativePlugins: boolean;
      vaultPath?: string;
      openVaultPath(path: string): Promise<void>;
      userscripts: UserscriptBridge;
      webviewer: {
        subscribe(listener: (page: { sourceGuestId: number; url: string }) => void): () => void;
      };
    };
  }
}
