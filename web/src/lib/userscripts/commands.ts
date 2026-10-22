import { userscriptRequest } from './client';
import { useStore } from '../store';
/** Aggregate in the existing native command registry. No second registry. */
export const userscriptCommands = [
  { id: 'userscripts-settings', title: '内置浏览器：管理用户脚本', run: () => {
    useStore.getState().setSettings(true); window.dispatchEvent(new CustomEvent('userscripts:open-settings'));
  } },
  { id: 'userscripts-check-updates', title: '内置浏览器：检查脚本更新', run: async () => {
    await userscriptRequest('check'); useStore.getState().notify('脚本更新检查完成，请在用户脚本设置查看各项结果');
  } },
];
