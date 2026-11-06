import type { RenderMenuItem } from './renderContext';

export function fileManagerMenuItems(path: string, folder: boolean, report: (message: string) => void): RenderMenuItem[] {
  const desktop = window.webobsidianDesktop;
  if (!desktop?.revealVaultPath) return [];
  const manager = desktop.platform === 'darwin' ? 'Finder' : desktop.platform === 'win32' ? '文件资源管理器' : '文件管理器';
  return [{ id: 'file:show-in-folder', label: `在 ${manager} 中${folder ? '打开' : '显示'}`, icon: 'folder-open',
    onClick: () => { void desktop.revealVaultPath!(path).catch(error => report(String(error))); } }];
}
