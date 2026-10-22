import type { ContextMenuItem } from '../store';

/** The existing menu model, with metadata also retained by the Obsidian adapter. */
export interface ConfiguredMenuItem extends Omit<ContextMenuItem, 'submenu' | 'onClick'> {
  id?: string;
  disabled?: boolean;
  checked?: boolean;
  section?: string;
  group?: string;
  submenu?: ConfiguredMenuItem[];
  onClick?: (event?: MouseEvent) => void;
}

export interface MenuContext {
  kind: string;
  source?: string;
  paths?: readonly string[];
  /** Supply an empty string for each selected folder in a mixed selection. */
  fileTypes?: readonly string[];
  activePath?: string;
  documentVersion?: number | string;
  selection?: Readonly<{ text: string; from?: number; to?: number }>;
  link?: string;
  tag?: string;
  modifiers?: Readonly<Partial<Record<'shift' | 'ctrl' | 'alt' | 'meta', boolean>>>;
}

export interface MenuCondition {
  contexts?: string[];
  sources?: string[];
  selection?: 'none' | 'text';
  files?: { min?: number; max?: number };
  fileTypes?: string[];
  fileMatch?: 'all' | 'any';
  paths?: string[];
  link?: boolean;
  tag?: boolean;
  modifiers?: Partial<Record<'shift' | 'ctrl' | 'alt' | 'meta', boolean>>;
  all?: MenuCondition[];
  any?: MenuCondition[];
  not?: MenuCondition;
}

export interface MenuMatch {
  id?: string | string[];
  /** Only matches contributions without an ID. Titles are whitespace/case normalized. */
  weak?: { title: string; icon?: string; section?: string };
}

export interface MenuMove {
  parent: string | null;
  before?: string;
  after?: string;
  index?: number;
}

export interface MenuRule {
  match: MenuMatch;
  when?: MenuCondition;
  hide?: boolean;
  title?: string;
  icon?: string;
  order?: number;
  group?: string;
  move?: MenuMove;
}

export interface MenuAddition {
  id: string;
  title?: string;
  icon?: string;
  command?: string;
  separator?: boolean;
  submenu?: MenuAddition[];
  when?: MenuCondition;
  order?: number;
  group?: string;
}

export interface MenuConfig {
  version: 1;
  includes?: string[];
  imports?: string[];
  rules?: MenuRule[];
  items?: MenuAddition[];
}

export interface MenuDiagnostic {
  file: string;
  line: number;
  column: number;
  offset: number;
  length: number;
  message: string;
}

export interface MenuSource {
  path: string;
  content: string;
  exists: boolean;
  revision?: string;
  /** Opaque server token binds every include/save to the same configured Vault. */
  vault: string;
}

export interface MenuStorage {
  read(path: string, vault?: string): Promise<MenuSource>;
  write(path: string, content: string, source: MenuSource): Promise<MenuSource>;
}

export interface MenuCommandHost {
  hasCommand(id: string, context: MenuContext): boolean;
  executeCommand(id: string, context: MenuContext): boolean | void | Promise<boolean | void>;
  /** Must reject stale editor versions/ranges before selection-sensitive actions. */
  isContextCurrent?(context: MenuContext): boolean;
  notify(message: string): void;
  openSettings(): void;
}

export interface CompiledMenuConfig {
  rules: readonly { rule: MenuRule; test: (context: MenuContext) => boolean }[];
  items: readonly CompiledAddition[];
}

export interface CompiledAddition {
  item: MenuAddition;
  test: (context: MenuContext) => boolean;
  submenu?: readonly CompiledAddition[];
}
