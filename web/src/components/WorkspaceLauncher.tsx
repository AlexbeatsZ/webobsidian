import { useState } from 'react';
import { useStore } from '../lib/store';
import Icon from './Icon';

/** Shared empty-workspace/new-dock-tab launcher; all actions use existing commands. */
export default function WorkspaceLauncher({ sidebarId }: { sidebarId?: string }) {
  const [url, setUrl] = useState('');
  const [addressOpen, setAddressOpen] = useState(false);
  const [error, setError] = useState('');
  const openBrowser = () => {
    try {
      const target = new URL(url.includes('://') ? url : 'https://' + url);
      if (!['http:', 'https:'].includes(target.protocol)) throw new Error('请输入 HTTP(S) 网页地址');
      if (!(window as any).webobsidianDesktop?.userscripts) throw new Error('内置浏览器需要原生桌面客户端');
      void useStore.getState().openRightTab('webviewer', { url: target.href }, sidebarId);
    } catch (cause) { setError(String(cause)); }
  };
  return <div className="workspace-launcher">
    <h3>Homepage</h3>
    <button className="launch-action" onClick={() => void useStore.getState().newNote().catch(cause => setError(String(cause)))}><Icon name="square-pen" size={16} /><span>新建笔记</span><kbd>Ctrl + N</kbd></button>
    <button className="launch-action" onClick={() => void useStore.getState().newCanvas().catch(cause => setError(String(cause)))}><Icon name="layout-dashboard" size={16} /><span>新建白板</span></button>
    <button className="launch-action" onClick={() => sidebarId ? useStore.getState().pickRightNote(sidebarId) : useStore.getState().setPalette(true, 'files')}><Icon name="search" size={16} /><span>打开文件</span><kbd>Ctrl + O</kbd></button>
    <button className="launch-action" onClick={() => setAddressOpen(value => !value)}><Icon name="globe" size={16} /><span>打开网页浏览器</span></button>
    {addressOpen && <form onSubmit={event => { event.preventDefault(); openBrowser(); }}>
      <label className="web-address"><Icon name="globe" size={16} /><input autoFocus aria-label="网页地址" placeholder="输入网页地址" value={url} onChange={event => setUrl(event.target.value)} /></label>
      <button className="launch-action" type="submit"><Icon name="arrow-right" size={16} />打开</button>
    </form>}
    <button className="launch-action" onClick={() => useStore.getState().setGraph(true)}><Icon name="graph" size={16} /><span>打开关系图谱</span></button>
    {error && <p className="editor-error" role="alert">{error}</p>}
  </div>;
}
