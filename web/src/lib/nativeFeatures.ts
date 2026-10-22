import { request, subscribeMutations } from './api';
import { documents } from './documents';
import { useStore } from './store';
import { sharedApp, runPluginCommand, pluginCommands } from './plugins';
import { getEditorForPath, getActiveEditor } from './activeEditor';
import { initializeConfiguredMenus } from './configuredMenus/controller';
import { configuredMenuStorage } from './configuredMenus/storage';
import type { MenuContext } from './configuredMenus/types';
import { workspaceMaintenanceBlockers } from './vaultMaintenance';
import type { CleanupDialogHost } from './attachments/types';
import { openTagOperation } from './tags/actions';
import { readNativeFeatures, saveNativeFeatures } from './nativeFeaturePreferences';
export { readNativeFeatures, saveNativeFeatures } from './nativeFeaturePreferences';
export type { NativeFeaturePreferences } from './nativeFeaturePreferences';

export function initializeNativeMenus(): () => void {
  const contextCurrent = (context: MenuContext) => {
    if (context.documentVersion === undefined) return true;
    const path = context.activePath;
    if (!path || documents.get(path)?.snapshot.version !== context.documentVersion) return false;
    const view = getEditorForPath(path), selection = context.selection;
    if (!view || getActiveEditor() !== view) return false;
    return !selection || (view.state.selection.main.from === selection.from &&
      view.state.selection.main.to === selection.to && view.state.sliceDoc(selection.from, selection.to) === selection.text);
  };
  return initializeConfiguredMenus(configuredMenuStorage, {
    hasCommand: (id, context) => {
      if (!sharedApp.commands.findCommand(id)) return false;
      if (context.paths?.length && !context.paths.includes(useStore.getState().activePath ?? '') &&
        /^(bookmark|move|save|split|reading|source|live|tags-batch-folder|editor:)/.test(id)) return false;
      return !pluginCommands.has(id) || runPluginCommand(id, true);
    },
    executeCommand: async (id, context) => {
      if (id === 'tags-batch-selected' && context.paths?.length) {
        const paths = useStore.getState().filePaths.filter(path => context.paths!.some(parent => path === parent || path.startsWith(parent + '/')));
        openTagOperation({ scope: { kind: 'files', paths } });
        return true;
      }
      return sharedApp.commands.executeCommandById(id);
    },
    isContextCurrent: contextCurrent,
    notify: message => useStore.getState().notify(message),
    openSettings: () => {
      useStore.getState().setSettings(true);
      window.dispatchEvent(new Event('menus:open-settings'));
    },
  });
}

export const attachmentDialogHost: CleanupDialogHost = {
  request, getBlockers: workspaceMaintenanceBlockers,
  loadOptions: async () => (await readNativeFeatures()).attachments,
  subscribeSafety(changed) {
    const stopDocuments = documents.subscribe(changed);
    const stopStore = useStore.subscribe((next, before) => {
      if (next.dirty !== before.dirty || next.pendingCanvasEdits !== before.pendingCanvasEdits || next.activePath !== before.activePath) changed();
    });
    const stopMutations = subscribeMutations(changed);
    window.addEventListener('vault-changed', changed);
    return () => { stopDocuments(); stopStore(); stopMutations(); window.removeEventListener('vault-changed', changed); };
  },
  openTrash: () => useStore.getState().setTrash(true),
  refreshFiles: () => useStore.getState().loadTree(),
  async saveOptions(options) {
    const value = await readNativeFeatures();
    await saveNativeFeatures({ vault: value.vault, attachments: options });
    attachmentDialogHost.initialOptions = options;
  },
};
