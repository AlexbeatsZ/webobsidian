import { useState } from 'react';
import { useStore } from '../lib/store';
import Icon from './Icon';

/** Shared empty-workspace/new-dock-tab launcher; all actions use existing commands. */
export default function WorkspaceLauncher({ sidebarId }: { sidebarId?: string }) {
  const [error, setError] = useState('');
  return <div className="workspace-launcher">
    <button className="launch-action" onClick={() => void useStore.getState().newNote().catch(cause => setError(String(cause)))}><Icon name="square-pen" size={16} /><span>新建笔记</span><kbd>Ctrl + N</kbd></button>
    <button className="launch-action" onClick={() => void useStore.getState().newCanvas().catch(cause => setError(String(cause)))}><Icon name="layout-dashboard" size={16} /><span>新建白板</span></button>
    <button className="launch-action" onClick={() => sidebarId ? useStore.getState().pickRightNote(sidebarId) : useStore.getState().setPalette(true, 'files')}><Icon name="search" size={16} /><span>打开文件</span><kbd>Ctrl + O</kbd></button>
    <button className="launch-action" onClick={() => useStore.getState().setGraph(true)}><Icon name="graph" size={16} /><span>打开关系图谱</span></button>
    {error && <p className="editor-error" role="alert">{error}</p>}
  </div>;
}
