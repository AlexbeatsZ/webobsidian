import type { McpLauncherState, McpConnectionInput } from '../../../desktop/src/mcpLauncher';

declare global {
  interface Window {
    webobsidianDesktop?: {
      isDesktop: boolean;
      platform: string;
      nativePlugins: boolean;
      mcp?: {
        inspect(): Promise<McpLauncherState>;
        configure(input: McpConnectionInput): Promise<McpLauncherState>;
        copyConfig(): Promise<void>;
        connect(): Promise<McpLauncherState>;
      };
      vaultPath?: string;
      openVaultPath(path: string): Promise<void>;
      revealVaultPath?(path: string): Promise<void>;
      onBeforeClose(listener: () => Promise<void>): () => void;
    };
  }
}
