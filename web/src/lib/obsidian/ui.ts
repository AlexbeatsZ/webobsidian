import { matchName } from '../search';
import { Component } from './events';
import { createDiv, createEl } from './dom';
import moment from 'moment';
import { iconPaths } from '../icons';
import { applyConfiguredMenu, subscribeMenuConfiguration } from '../configuredMenus/controller';
import { menuModifiers, snapshotMenuContext } from '../configuredMenus/transform';
import type { ConfiguredMenuItem, MenuContext } from '../configuredMenus/types';
export class Notice {
  noticeEl = createDiv({ cls: 'toast plugin-notice' });
  constructor(message: string | DocumentFragment, timeout = 4000) {
    this.setMessage(message);
    document.body.appendChild(this.noticeEl);
    if (timeout > 0) window.setTimeout(() => this.hide(), timeout);
  }
  setMessage(message: string | DocumentFragment) {
    this.noticeEl.replaceChildren(typeof message === 'string' ? document.createTextNode(message) : message);
    return this;
  }
  hide() {
    this.noticeEl.remove();
  }
}
export class Scope {
  private keys: { modifiers: string[]; key: string; func: Function }[] = [];
  constructor(public parent?: Scope) {}
  register(modifiers: string[] | null, key: string | null, func: Function) {
    const entry = { modifiers: modifiers ?? [], key: key ?? '', func };
    this.keys.push(entry);
    return entry;
  }
  unregister(entry: any) {
    this.keys = this.keys.filter((k) => k !== entry);
  }
  handle(event: KeyboardEvent) {
    for (const k of this.keys)
      if (k.key.toLowerCase() === event.key.toLowerCase() && matchesModifiers(event, k.modifiers)) {
        if (k.func(event, k) === false) event.preventDefault();
        return;
      }
    this.parent?.handle(event);
  }
}
export function matchesModifiers(e: KeyboardEvent, mods: string[]) {
  const mac = /Mac/.test(navigator.platform),
    mod = mods.includes('Mod');
  return (
    e.ctrlKey === (mods.includes('Ctrl') || (mod && !mac)) &&
    e.metaKey === (mods.includes('Meta') || (mod && mac)) &&
    e.altKey === mods.includes('Alt') &&
    e.shiftKey === mods.includes('Shift')
  );
}
export const Keymap = {
  isModEvent: (e: MouseEvent | KeyboardEvent) => (/Mac/.test(navigator.platform) ? e.metaKey : e.ctrlKey),
  isModifier: (e: KeyboardEvent, name: string) => matchesModifiers(e, [name]),
};
export class Modal {
  containerEl: HTMLElement = createDiv({
    cls: 'modal-bg modal-container plugin-modal',
  });
  modalEl: HTMLElement = createDiv({ cls: 'modal', parent: this.containerEl });
  titleEl: HTMLElement = createEl('h2', { parent: this.modalEl });
  contentEl: HTMLElement = createDiv({
    cls: 'modal-content',
    parent: this.modalEl,
  });
  scope = new Scope();
  private opened = false;
  constructor(public app: any) {
    this.containerEl.addEventListener('click', (e) => {
      if (e.target === this.containerEl) this.close();
    });
    this.containerEl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
      this.scope.handle(e);
    });
  }
  setTitle(title: string) {
    this.titleEl.textContent = title;
    return this;
  }
  open() {
    if (this.opened) return;
    this.opened = true;
    document.body.appendChild(this.containerEl);
    this.onOpen();
    this.contentEl.querySelector<HTMLElement>('input,button,textarea')?.focus();
  }
  close() {
    if (!this.opened) return;
    this.opened = false;
    try {
      this.onClose();
    } finally {
      this.containerEl.remove();
    }
  }
  onOpen() {}
  onClose() {}
}
export class SuggestModal<T = any> extends Modal {
  inputEl = createEl('input', { cls: 'palette-input' }) as HTMLInputElement;
  resultContainerEl: HTMLElement = createDiv({ cls: 'suggestion-container' });
  private results: T[] = [];
  private selected = 0;
  private generation = 0;
  constructor(app: any) {
    super(app);
    this.contentEl.append(this.inputEl, this.resultContainerEl);
    this.inputEl.addEventListener('input', () => void this.update());
    this.inputEl.addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        this.selected = Math.max(
          0,
          Math.min(this.results.length - 1, this.selected + (e.key === 'ArrowDown' ? 1 : -1)),
        );
        this.draw();
      }
      if (e.key === 'Enter' && this.results[this.selected] !== undefined)
        this.selectSuggestion(this.results[this.selected], e);
    });
  }
  setPlaceholder(value: string) {
    this.inputEl.placeholder = value;
    return this;
  }
  setInstructions(items: { command: string; purpose: string }[]) {
    const el = createDiv({ cls: 'prompt-instructions', parent: this.modalEl });
    el.textContent = items.map((i) => `${i.command}: ${i.purpose}`).join(' · ');
    return this;
  }
  async update() {
    const generation = ++this.generation;
    const result = await this.getSuggestions(this.inputEl.value);
    if (generation !== this.generation) return;
    this.results = result;
    this.selected = 0;
    this.draw();
  }
  private draw() {
    this.resultContainerEl.replaceChildren();
    this.results.slice(0, 100).forEach((item, index) => {
      const el = createDiv({
        cls: `suggestion-item ${index === this.selected ? 'is-selected' : ''}`,
        parent: this.resultContainerEl,
      });
      this.renderSuggestion(item, el);
      el.addEventListener('click', (e: MouseEvent) => this.selectSuggestion(item, e));
    });
  }
  onOpen() {
    void this.update();
  }
  getSuggestions(_query: string): T[] | Promise<T[]> {
    return [];
  }
  renderSuggestion(item: T, el: HTMLElement) {
    el.textContent = String(item);
  }
  selectSuggestion(item: T, event: MouseEvent | KeyboardEvent) {
    this.onChooseSuggestion(item, event);
    this.close();
  }
  onChooseSuggestion(_item: T, _event: MouseEvent | KeyboardEvent) {}
}
export class ConfirmationModal extends Modal {
  private resolve?: (confirmed: boolean) => void;
  confirmButton = new ButtonComponent(this.modalEl)
    .setButtonText('Confirm')
    .setCta()
    .onClick(() => {
      this.resolve?.(true);
      this.close();
    });
  cancelButton = new ButtonComponent(this.modalEl).setButtonText('Cancel').onClick(() => this.close());
  setButtonText(text: string) {
    this.confirmButton.setButtonText(text);
    return this;
  }
  setCta() {
    this.confirmButton.setCta();
    return this;
  }
  setWarning() {
    this.confirmButton.setWarning();
    return this;
  }
  openAndGetResult(): Promise<boolean> {
    return new Promise((resolve) => {
      this.resolve = resolve;
      this.open();
    });
  }
  onClose() {
    this.resolve?.(false);
    this.resolve = undefined;
  }
}
export class FuzzySuggestModal<T = any> extends SuggestModal<{
  item: T;
  match: any;
}> {
  getItems(): T[] {
    return [];
  }
  getItemText(item: T) {
    return String(item);
  }
  getSuggestions(q: string) {
    return this.getItems()
      .flatMap((item) => {
        const match = matchName(q, this.getItemText(item));
        return match ? [{ item, match }] : [];
      })
      .sort((a, b) => b.match.score - a.match.score);
  }
  renderSuggestion(value: { item: T }, el: HTMLElement) {
    el.textContent = this.getItemText(value.item);
  }
  onChooseSuggestion(value: { item: T }, e: any) {
    this.onChooseItem(value.item, e);
  }
  onChooseItem(_item: T, _e: any) {}
}
/** Shared Promise dialogs for commands and templates. Cancel rejects without a value. */
export function promptInput(app: unknown, message: string, initial = '', signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    let accepted = false;
    const modal = new (class extends Modal {
      onClose() {
        signal?.removeEventListener('abort', abort);
        if (!accepted) reject(new DOMException('已取消', 'AbortError'));
      }
    })(app);
    const abort = () => modal.close();
    modal.setTitle(message);
    const input = document.createElement('input'); input.className = 'text-input'; input.value = initial;
    const button = document.createElement('button'); button.textContent = '确定';
    const submit = () => { accepted = true; resolve(input.value); modal.close(); };
    input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); submit(); } });
    button.onclick = submit; modal.contentEl.append(input, button);
    signal?.addEventListener('abort', abort, { once: true }); modal.open(); input.select();
  });
}
export function chooseInput<T>(app: unknown, message: string, items: readonly T[], label: (item: T) => string = String,
  signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    let accepted = false;
    const modal = new (class extends FuzzySuggestModal<T> {
      getItems() { return [...items]; }
      getItemText(item: T) { return label(item); }
      onChooseItem(item: T) { accepted = true; resolve(item); }
      onClose() {
        signal?.removeEventListener('abort', abort);
        if (!accepted) reject(new DOMException('已取消', 'AbortError'));
      }
    })(app);
    const abort = () => modal.close();
    modal.setTitle(message); modal.setPlaceholder(message);
    signal?.addEventListener('abort', abort, { once: true }); modal.open();
  });
}
export class AbstractInputSuggest<T = any> extends Component {
  scope = new Scope();
  private modal: SuggestModal<T>;
  constructor(
    public app: any,
    public textInputEl: HTMLInputElement | HTMLTextAreaElement,
  ) {
    super();
    const suggest = this;
    this.modal = new (class extends SuggestModal<T> {
      getSuggestions(q: string) {
        return suggest.getSuggestions(q);
      }
      renderSuggestion(value: T, el: HTMLElement) {
        suggest.renderSuggestion(value, el);
      }
      onChooseSuggestion(value: T, event: any) {
        suggest.selectSuggestion(value, event);
      }
    })(app);
    const update = () => {
      this.modal.inputEl.value = textInputEl.value;
      void this.modal.update();
    };
    textInputEl.addEventListener('input', update);
    this.register(() => textInputEl.removeEventListener('input', update));
  }
  getSuggestions(_query: string): T[] | Promise<T[]> {
    return [];
  }
  renderSuggestion(value: T, el: HTMLElement) {
    el.textContent = String(value);
  }
  selectSuggestion(value: T, _event: any) {
    this.setValue(String(value));
    this.close();
  }
  setValue(value: string) {
    this.textInputEl.value = value;
    this.textInputEl.dispatchEvent(new Event('input', { bubbles: true }));
  }
  getValue() {
    return this.textInputEl.value;
  }
  open() {
    this.modal.open();
  }
  close() {
    this.modal.close();
  }
  setInstructions(items: any) {
    this.modal.setInstructions(items);
    return this;
  }
}
export class SettingPage extends Component {
  containerEl: HTMLElement;
  constructor(containerEl: HTMLElement) {
    super();
    this.containerEl = containerEl;
  }
  display() {}
  hide() {}
}
export class BaseComponent<T extends HTMLElement = HTMLElement> {
  constructor(public inputEl: T) {}
  setDisabled(value: boolean) {
    (this.inputEl as any).disabled = value;
    return this;
  }
  then(cb: (self: this) => void) {
    cb(this);
    return this;
  }
}
export class TextComponent extends BaseComponent<HTMLInputElement> {
  containerEl: HTMLElement;
  constructor(container: HTMLElement, tag = 'input') {
    super(createEl(tag, { cls: 'text-input', parent: container }));
    this.containerEl = container;
  }
  setValue(v: string) {
    this.inputEl.value = v ?? '';
    return this;
  }
  getValue() {
    return this.inputEl.value;
  }
  setPlaceholder(v: string) {
    this.inputEl.placeholder = v;
    return this;
  }
  onChange(cb: (value: string) => void) {
    this.inputEl.addEventListener('input', () => cb(this.getValue()));
    return this;
  }
}
export class TextAreaComponent extends TextComponent {
  constructor(container: HTMLElement) {
    super(container, 'textarea');
  }
}
export class SearchComponent extends TextComponent {
  clearButtonEl: HTMLButtonElement;
  constructor(container: HTMLElement) {
    const wrapper = createDiv({
      cls: 'search-input-container',
      parent: container,
    });
    super(wrapper);
    this.inputEl.type = 'search';
    this.clearButtonEl = createEl('button', {
      text: '×',
      title: 'Clear search',
      parent: wrapper,
    });
    this.clearButtonEl.onclick = () => {
      this.setValue('');
      this.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    };
  }
}
export class MomentFormatComponent extends TextComponent {
  private sample?: HTMLElement;
  private defaultFormat = 'YYYY-MM-DD';
  constructor(container: HTMLElement) {
    super(container);
    this.inputEl.addEventListener('input', () => this.updateSample());
  }
  setDefaultFormat(value: string) {
    this.defaultFormat = value;
    this.setPlaceholder(value);
    this.updateSample();
    return this;
  }
  setSampleEl(el: HTMLElement) {
    this.sample = el;
    this.updateSample();
    return this;
  }
  setValue(value: string) {
    super.setValue(value);
    this.updateSample();
    return this;
  }
  private updateSample() {
    if (this.sample) this.sample.textContent = moment().format(this.getValue() || this.defaultFormat);
  }
}
export class ToggleComponent extends BaseComponent<HTMLInputElement> {
  toggleEl: HTMLElement;
  constructor(container: HTMLElement) {
    super(createEl('input', { type: 'checkbox', parent: container }));
    this.toggleEl = this.inputEl;
  }
  setValue(v: boolean) {
    this.inputEl.checked = v;
    return this;
  }
  getValue() {
    return this.inputEl.checked;
  }
  onChange(cb: (v: boolean) => void) {
    this.inputEl.addEventListener('change', () => cb(this.getValue()));
    return this;
  }
}
export class ButtonComponent extends BaseComponent<HTMLButtonElement> {
  buttonEl: HTMLButtonElement;
  constructor(container: HTMLElement) {
    super(createEl('button', { cls: 'btn secondary', parent: container }));
    this.buttonEl = this.inputEl;
  }
  setButtonText(v: string) {
    this.buttonEl.textContent = v;
    return this;
  }
  setTooltip(v: string) {
    this.buttonEl.title = v;
    return this;
  }
  setIcon(v: string) {
    setIcon(this.buttonEl, v);
    return this;
  }
  setCta() {
    this.buttonEl.classList.remove('secondary');
    return this;
  }
  removeCta() {
    this.buttonEl.classList.add('secondary');
    return this;
  }
  setWarning() {
    this.buttonEl.classList.add('danger');
    return this;
  }
  onClick(cb: (e: MouseEvent) => void) {
    this.buttonEl.addEventListener('click', cb);
    return this;
  }
}
export class ExtraButtonComponent extends ButtonComponent {
  extraSettingsEl = this.buttonEl;
}
export class DropdownComponent extends BaseComponent<HTMLSelectElement> {
  selectEl: HTMLSelectElement;
  constructor(container: HTMLElement) {
    super(createEl('select', { cls: 'text-input', parent: container }));
    this.selectEl = this.inputEl;
  }
  addOption(value: string, display: string) {
    this.selectEl.add(new Option(display, value));
    return this;
  }
  addOptions(options: Record<string, string>) {
    for (const [k, v] of Object.entries(options)) this.addOption(k, v);
    return this;
  }
  setValue(value: string) {
    this.selectEl.value = value;
    return this;
  }
  getValue() {
    return this.selectEl.value;
  }
  onChange(cb: (v: string) => void) {
    this.selectEl.addEventListener('change', () => cb(this.getValue()));
    return this;
  }
}
export class SliderComponent extends BaseComponent<HTMLInputElement> {
  sliderEl: HTMLInputElement;
  constructor(container: HTMLElement) {
    super(createEl('input', { type: 'range', parent: container }));
    this.sliderEl = this.inputEl;
  }
  setLimits(min: number, max: number, step: number) {
    Object.assign(this.sliderEl, { min, max, step });
    return this;
  }
  setValue(value: number) {
    this.sliderEl.value = String(value);
    return this;
  }
  getValue() {
    return Number(this.sliderEl.value);
  }
  setDynamicTooltip() {
    this.sliderEl.addEventListener('input', () => (this.sliderEl.title = this.sliderEl.value));
    return this;
  }
  onChange(cb: (v: number) => void) {
    this.sliderEl.addEventListener('input', () => cb(this.getValue()));
    return this;
  }
}
export class Setting {
  settingEl: HTMLElement;
  infoEl: HTMLElement;
  nameEl: HTMLElement;
  descEl: HTMLElement;
  controlEl: HTMLElement;
  components: any[] = [];
  constructor(container: HTMLElement) {
    this.settingEl = createDiv({
      cls: 'setting-item setting-row',
      parent: container,
    });
    this.infoEl = createDiv({
      cls: 'setting-item-info info',
      parent: this.settingEl,
    });
    this.nameEl = createDiv({
      cls: 'setting-item-name name',
      parent: this.infoEl,
    });
    this.descEl = createDiv({
      cls: 'setting-item-description desc',
      parent: this.infoEl,
    });
    this.controlEl = createDiv({
      cls: 'setting-item-control control',
      parent: this.settingEl,
    });
  }
  setName(v: string | DocumentFragment) {
    this.nameEl.replaceChildren(v);
    return this;
  }
  setDesc(v: string | DocumentFragment) {
    this.descEl.replaceChildren(v);
    return this;
  }
  setHeading() {
    this.settingEl.classList.add('setting-item-heading');
    return this;
  }
  setClass(v: string) {
    this.settingEl.classList.add(v);
    return this;
  }
  setDisabled(v: boolean) {
    this.components.forEach((c) => c.setDisabled(v));
    return this;
  }
  then(cb: (self: this) => void) {
    cb(this);
    return this;
  }
  private add(Type: any, cb: (c: any) => void) {
    const c = new Type(this.controlEl);
    this.components.push(c);
    cb(c);
    return this;
  }
  addText(cb: (c: TextComponent) => void) {
    return this.add(TextComponent, cb);
  }
  addTextArea(cb: (c: TextAreaComponent) => void) {
    return this.add(TextAreaComponent, cb);
  }
  addSearch(cb: (c: SearchComponent) => void) {
    return this.add(SearchComponent, cb);
  }
  addMomentFormat(cb: (c: MomentFormatComponent) => void) {
    return this.add(MomentFormatComponent, cb);
  }
  addToggle(cb: (c: ToggleComponent) => void) {
    return this.add(ToggleComponent, cb);
  }
  addButton(cb: (c: ButtonComponent) => void) {
    return this.add(ButtonComponent, cb);
  }
  addExtraButton(cb: (c: ExtraButtonComponent) => void) {
    return this.add(ExtraButtonComponent, cb);
  }
  addDropdown(cb: (c: DropdownComponent) => void) {
    return this.add(DropdownComponent, cb);
  }
  addSlider(cb: (c: SliderComponent) => void) {
    return this.add(SliderComponent, cb);
  }
  clear() {
    this.controlEl.replaceChildren();
    this.components = [];
    return this;
  }
}
export class PluginSettingTab {
  id: string;
  name: string;
  containerEl = createDiv({ cls: 'vertical-tab-content' });
  constructor(
    public app: any,
    public plugin: any,
  ) {
    this.id = plugin.manifest.id;
    this.name = plugin.manifest.name;
  }
  display() {}
  hide() {}
}
const icons = new Map<string, string>();
export function addIcon(name: string, svg: string) {
  icons.set(name, svg);
}
export function getIcon(name: string): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.75');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.classList.add('svg-icon');
  if (icons.has(name)) svg.innerHTML = icons.get(name)!;
  else svg.innerHTML = iconPaths[name.replace(/^lucide-/, '')] ?? iconPaths.file;
  return svg;
}
export function setIcon(el: HTMLElement, name: string) {
  el.replaceChildren(getIcon(name));
}
export function setTooltip(el: HTMLElement, text: string, _options?: any) {
  el.title = text;
}
export class MenuItem {
  id?: string;
  title = '';
  icon = '';
  disabled = false;
  checked?: boolean;
  section = '';
  group?: string;
  danger = false;
  callback?: (e: MouseEvent) => void;
  submenu?: Menu;
  setTitle(v: string) {
    this.title = v;
    return this;
  }
  setIcon(v: string) {
    this.icon = v;
    return this;
  }
  setDisabled(v: boolean) {
    this.disabled = v;
    return this;
  }
  setChecked(v: boolean) {
    this.checked = v;
    return this;
  }
  setId(v: string) {
    this.id = v;
    return this;
  }
  setSection(v: string) {
    this.section = v;
    return this;
  }
  setWarning(v = true) {
    this.danger = v;
    return this;
  }
  onClick(cb: (e: MouseEvent) => void) {
    this.callback = cb;
    return this;
  }
  setSubmenu() {
    return (this.submenu = new Menu());
  }
}
export class Menu extends Component {
  items: (MenuItem | null)[] = [];
  dom = createDiv({ cls: 'menu plugin-menu' });
  context: MenuContext = { kind: 'generic' };
  private shownChildren = new Set<Menu>();
  private rootMenu?: Menu;
  private unsubscribeConfiguration?: () => void;
  setContext(context: MenuContext) {
    this.context = snapshotMenuContext(context);
    return this;
  }
  /** Lossless bridge; no rules run until the completed model is rendered. */
  toContextMenuItems(): ConfiguredMenuItem[] {
    return this.items.map((item) => item ? {
      id: item.id, label: item.title, icon: item.icon, disabled: item.disabled,
      checked: item.checked, section: item.section, group: item.group, danger: item.danger,
      onClick: (event?: MouseEvent) => item.callback?.(event ?? new MouseEvent('click')),
      submenu: item.submenu?.toContextMenuItems(),
    } : { label: '', separator: true });
  }
  loadContextMenuItems(items: readonly ConfiguredMenuItem[]) {
    for (const item of items) {
      if (item.separator) { this.addSeparator(); continue; }
      this.addItem((m) => {
        m.setTitle(item.label).setDisabled(item.disabled ?? false);
        if (item.checked !== undefined) m.setChecked(item.checked);
        m.id = item.id; m.section = item.section ?? ''; m.group = item.group; m.danger = item.danger ?? false;
        if (item.icon) m.setIcon(item.icon);
        m.onClick((event) => item.onClick?.(event));
        if (item.submenu) m.setSubmenu().loadContextMenuItems(item.submenu);
      });
    }
    return this;
  }
  addItem(cb: (item: MenuItem) => void) {
    const item = new MenuItem();
    cb(item);
    this.items.push(item);
    return this;
  }
  addSeparator() {
    this.items.push(null);
    return this;
  }
  showAtMouseEvent(e: MouseEvent) {
    this.context = snapshotMenuContext({ ...this.context, modifiers: menuModifiers(e) });
    this.showAtPosition({ x: e.clientX, y: e.clientY });
  }
  showAtPosition(pos: { x: number; y: number }) {
    this.hide();
    const items = applyConfiguredMenu(this.toContextMenuItems(), this.context);
    if (!items.length) return;
    this.showItemsAtPosition(items, pos);
    // Closing an already-open imperative menu on reload avoids retaining stale
    // callbacks/selection. The next open uses the new compiled configuration.
    this.unsubscribeConfiguration = subscribeMenuConfiguration(() => this.hide());
  }
  private containsTarget(target: Node): boolean {
    return this.dom.contains(target) || [...this.shownChildren].some((child) => child.containsTarget(target));
  }
  private showItemsAtPosition(items: ConfiguredMenuItem[], pos: { x: number; y: number }, root?: Menu) {
    this.rootMenu = root;
    this.dom.replaceChildren();
    this.dom.setAttribute('role', 'menu');
    Object.assign(this.dom.style, {
      position: 'fixed',
      left: `${pos.x}px`,
      top: `${pos.y}px`,
      zIndex: '10000',
    });
    for (const item of items) {
      if (item.separator) {
        const separator = createEl('hr');
        separator.setAttribute('role', 'separator');
        this.dom.append(separator);
        continue;
      }
      const el = createEl('button', {
        cls: 'menu-item context-item',
        parent: this.dom,
      }) as HTMLButtonElement;
      const icon = createDiv({ cls: 'ctx-icon', parent: el });
      if (item.icon) icon.append(getIcon(item.icon));
      createEl('span', { cls: 'ctx-label', text: item.label, parent: el });
      if (item.checked) el.append(getIcon('check'));
      if (item.submenu) el.append(getIcon('chevron-right'));
      el.disabled = item.disabled ?? false;
      el.setAttribute('role', item.checked === undefined ? 'menuitem' : 'menuitemcheckbox');
      if (item.checked !== undefined) el.setAttribute('aria-checked', String(item.checked));
      if (item.danger) el.classList.add('danger');
      if (item.submenu) el.setAttribute('aria-haspopup', 'menu');
      el.onclick = (e) => {
        e.stopPropagation();
        if (item.disabled) return;
        if (item.submenu) {
          for (const child of this.shownChildren) child.hide();
          this.shownChildren.clear();
          const child = new Menu();
          this.shownChildren.add(child);
          const bounds = el.getBoundingClientRect();
          child.showItemsAtPosition(item.submenu, { x: bounds.right, y: bounds.top }, this.rootMenu ?? this);
        }
        else {
          try { item.onClick?.(e); }
          finally { (this.rootMenu ?? this).hide(); }
        }
      };
    }
    document.body.append(this.dom);
    this.closeListener = (e: Event) => {
      if (!this.containsTarget(e.target as Node)) this.hide();
    };
    document.addEventListener('pointerdown', this.closeListener);
    this.keyListener = (event: KeyboardEvent) => { if (event.key === 'Escape') (this.rootMenu ?? this).hide(); };
    document.addEventListener('keydown', this.keyListener);
  }
  private closeListener?: EventListener;
  private keyListener?: (event: KeyboardEvent) => void;
  hide() {
    for (const child of this.shownChildren) child.hide();
    this.shownChildren.clear();
    this.dom.remove();
    if (this.closeListener) document.removeEventListener('pointerdown', this.closeListener);
    this.closeListener = undefined;
    if (this.keyListener) document.removeEventListener('keydown', this.keyListener);
    this.keyListener = undefined;
    this.unsubscribeConfiguration?.();
    this.unsubscribeConfiguration = undefined;
  }
  onunload() {
    this.hide();
  }
}
