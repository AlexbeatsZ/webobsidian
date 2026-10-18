import { ItemView, type WorkspaceLeaf } from './workspace';
import { createEl } from './dom';
import { Modal, Setting } from './ui';

/** Native remote content always lives in a sandboxed guest, never the host. */
export class WebViewerView extends ItemView {
  webview: any;
  url = '';
  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.webview = createEl('webview');
    Object.assign(this.webview.style, {
      width: 'min(1000px,80vw)',
      height: '70vh',
      display: 'flex',
    });
    this.contentEl.append(this.webview);
  }
  getViewType() {
    return 'webviewer';
  }
  getDisplayText() {
    return this.url || 'Web viewer';
  }
  async setState(state: any) {
    const url = new URL(state.url);
    if (!['http:', 'https:'].includes(url.protocol))
      throw new Error('Web viewer requires an HTTP(S) URL');
    this.url = url.href;
    this.webview.src = this.url;
  }
  getState() {
    return { url: this.url };
  }
  async onClose() {
    this.webview.remove();
  }
}
export function promptWebViewer(app: any) {
  const modal = new Modal(app);
  modal.setTitle('Open web viewer');
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
