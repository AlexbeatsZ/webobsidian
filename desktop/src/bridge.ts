import type { McpConnectionInput, McpLauncherState } from './mcpLauncher';

export const desktopCommands = ['new', 'files', 'save', 'settings', 'vault-switch'] as const;
export type DesktopCommand = typeof desktopCommands[number];

export interface DesktopBridge {
  isDesktop: true;
  platform: string;
  version: string;
  nativePlugins: boolean;
  vaultPath?: string;
  mcp: {
    inspect(): Promise<McpLauncherState>;
    configure(input: McpConnectionInput): Promise<McpLauncherState>;
    copyConfig(): Promise<void>;
    connect(): Promise<McpLauncherState>;
  };
  openVaultPath(path: string): Promise<void>;
  revealVaultPath(path: string): Promise<void>;
  setChrome(dark: boolean, workspace: boolean): void;
  onBeforeClose(listener: () => Promise<void>): () => void;
}
