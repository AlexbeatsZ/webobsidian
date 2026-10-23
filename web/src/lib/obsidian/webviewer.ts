import { ItemView, type WorkspaceLeaf } from './workspace';
import { createEl } from './dom';
import { Modal, Setting, setIcon } from './ui';
import { bootstrapUserscripts, subscribeUserscripts, userscriptBridge, userscriptMenus, userscriptRequest, userscriptSnapshot } from '../userscripts/client';

/** Native remote content always lives in a sandboxed guest, never the host. */
export class WebViewerView extends ItemView {
  webview: any;
  url = '';
  private cleanup: (() => void)[] = [];
  private address: HTMLInputElement;
  private status: HTMLElement;
  private menu: HTMLSelectElement;
  private closed = false;
  private title = '';
  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    const controls = createEl('div');
    this.containerEl.classList.add('webviewer-view');
    controls.className = 'webviewer-controls';
    const button = (icon: string, title: string, action: () => void) => {
      const el = createEl('button'); setIcon(el, icon); el.title = title; el.setAttribute('aria-label', title);
      el.addEventListener('click', action); controls.append(el); return el;
    };
    button('arrow-left', '后退', () => { if (this.webview?.canGoBack()) this.webview.goBack(); });
    button('arrow-right', '前进', () => { if (this.webview?.canGoForward()) this.webview.goForward(); });
    button('refresh-cw', '重新加载页面及用户脚本', () => this.webview?.reload());
    this.address = createEl('input'); this.address.type = 'url'; this.address.className = 'text-input'; this.address.setAttribute('aria-label', '浏览器地址');
    this.address.addEventListener('keydown', e => { if (e.key === 'Enter') void this.setState({ url: this.address.value }).catch(error => this.status.textContent = String(error)); });
    controls.append(this.address);
    this.menu = createEl('select'); this.menu.setAttribute('aria-label', '当前页面脚本菜单');
    controls.append(this.menu);
    this.status = createEl('div'); this.status.setAttribute('role', 'status');
    this.status.className = 'webviewer-status';
    this.contentEl.append(controls, this.status);
    if (!userscriptBridge()) {
      this.status.textContent = '内置浏览器及用户脚本需要原生桌面客户端';
      return;
    }
    this.webview = createEl('webview');
    Object.assign(this.webview.style, {
      width: '100%',
      flex: '1', minHeight: '0',
      display: 'flex',
    });
    this.contentEl.append(this.webview);
    this.cleanup.push(bootstrapUserscripts(), subscribeUserscripts(() => this.updateStatus()));
    const navigated = () => {
      this.url = this.webview.getURL(); this.address.value = this.url;
      this.updateStatus(); void this.updateMenus();
      this.leaf.workspace.updateRightLeaf(this.leaf);
    };
    this.webview.addEventListener('dom-ready', navigated);
    this.webview.addEventListener('did-navigate', navigated);
    this.webview.addEventListener('did-navigate-in-page', navigated);
    this.webview.addEventListener('page-title-updated', (event: { title: string }) => {
      this.title = event.title; this.leaf.workspace.updateRightLeaf(this.leaf);
    });
    this.webview.addEventListener('did-fail-load', (e: any) => { if (e.isMainFrame && e.errorCode !== -3) this.status.textContent = `页面加载失败：${e.errorDescription}`; });
    this.menu.addEventListener('focus', () => void this.updateMenus());
    this.menu.addEventListener('change', () => {
      if (!this.menu.value) return;
      void userscriptRequest('invoke-menu', JSON.parse(this.menu.value)).catch(error => this.status.textContent = String(error));
      this.menu.value = '';
    });
    void this.updateMenus();
  }
  guestId() { try { return this.webview?.getWebContentsId(); } catch { return undefined; } }
  private updateStatus() {
    if (this.closed) return;
    const states = userscriptSnapshot()?.statuses.filter(s => s.guestId === this.guestId()) ?? [];
    this.status.textContent = states.length ? states.map(s => `${s.state}${s.message ? ': ' + s.message : ''}`).join(' · ') : '页面已准备；脚本按匹配规则运行';
  }
  private async updateMenus() {
    try {
      const menus = (await userscriptMenus()).filter(m => m.guestId === this.guestId());
      if (this.closed) return;
      this.menu.replaceChildren();
      const placeholder = createEl('option'); placeholder.value = ''; placeholder.textContent = `脚本菜单 (${menus.length})`; this.menu.append(placeholder);
      for (const item of menus) { const option = createEl('option'); option.value = JSON.stringify(item); option.textContent = item.label; this.menu.append(option); }
    } catch (e) { if (!this.closed) this.status.textContent = String(e); }
  }
  getViewType() {
    return 'webviewer';
  }
  getDisplayText() {
    return this.title || this.url || '浏览器';
  }
  getIcon() { return 'globe'; }
  async setState(state: any) {
    const url = new URL(state.url);
    if (!['http:', 'https:'].includes(url.protocol))
      throw new Error('网页视图需要 HTTP(S) 地址');
    if (this.url === url.href && this.webview?.src) return;
    this.url = url.href;
    this.title = '';
    this.address.value = this.url;
    if (!this.webview) throw new Error('网页视图需要桌面客户端');
    this.webview.src = this.url;
  }
  getState() {
    return { url: this.url };
  }
  async onClose() {
    this.closed = true;
    for (const stop of this.cleanup) stop();
    this.webview?.remove();
  }
}
export function promptWebViewer(app: any) {
  const modal = new Modal(app);
  modal.setTitle('打开网页视图');
  let url = 'https://';
  new Setting(modal.contentEl)
    .setName('URL')
    .addText((text) => text.setValue(url).onChange((value) => (url = value)));
  new Setting(modal.contentEl).addButton((button) =>
    button
      .setButtonText('Open')
      .setCta()
      .onClick(() => {
        void app.workspace
          .getLeaf(true)
          .setViewState({ type: 'webviewer', state: { url } })
          .then(() => modal.close())
          .catch((e: Error) => {
            modal.titleEl.textContent = e.message;
          });
      })
  );
  modal.open();
}
