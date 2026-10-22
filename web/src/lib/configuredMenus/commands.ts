import { getMenuConfigurationController } from './controller';

export function downloadMenuConfiguration(): void {
  const controller = getMenuConfigurationController();
  if (!controller) throw new Error('Menu configuration is not initialized');
  const url = URL.createObjectURL(new Blob([controller.exportSources()], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'webobsidian-menu-config.json';
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Aggregate into nativeCommands; no parallel command registry is installed. */
export const configuredMenuCommands = [
  { id: 'menus:configure', title: '右键菜单：打开配置', run: () => getMenuConfigurationController()?.host.openSettings() },
  { id: 'menus:reload', title: '右键菜单：重新加载配置', run: async () => {
    const controller = getMenuConfigurationController();
    if (!controller) return;
    const ok = await controller.reload();
    controller.host.notify(ok ? '右键菜单配置已更新。' : '配置有误；保留本 Vault 上一个有效配置。请查看设置中的错误位置。');
  } },
  { id: 'menus:export', title: '右键菜单：导出配置与导入文件', run: downloadMenuConfiguration },
];
