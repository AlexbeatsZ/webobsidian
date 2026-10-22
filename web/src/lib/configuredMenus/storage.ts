import { request } from '../api';
import type { MenuSource, MenuStorage } from './types';

export const configuredMenuStorage: MenuStorage = {
  read: (path, vault) => request<MenuSource>(`/api/menus/config?path=${encodeURIComponent(path)}${vault === undefined ? '' : `&vault=${encodeURIComponent(vault)}`}`),
  write: (path, content, source) => request<MenuSource>('/api/menus/config', {
    method: 'PUT',
    body: JSON.stringify({ path, content, vault: source.vault, exists: source.exists, revision: source.revision }),
  }),
};
