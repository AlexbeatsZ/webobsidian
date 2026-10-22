import { Facet } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { MenuContext } from './configuredMenus/types';

export interface RenderMenuItem {
  id?: string; label: string; icon?: string; disabled?: boolean; checked?: boolean;
  section?: string; group?: string; onClick?: (event?: MouseEvent) => void;
  submenu?: RenderMenuItem[]; separator?: boolean;
}
export interface PropertySuggestion { key: string; type: string; count: number }
export interface FragmentOptions {
  id: string; mode?: 'live' | 'reading'; sourceFrom?: number; autoFocus?: boolean;
  context?: RenderContext; onCommit?: (source: string) => void;
  onReady?: () => void;
}
export interface EmbeddedNote {
  path: string; context: RenderContext;
  read: () => { source: string; from: number } | null;
  subscribe: (listener: () => void) => () => void;
}

/** Services are scoped to a view's source document and capability boundary. */
export interface RenderContext {
  sourcePath: string;
  openLink: (target: string) => void;
  openMenu: (menu: { x: number; y: number; items: RenderMenuItem[]; context?: MenuContext }) => void;
  tagMenu?: (tag: string, event: MouseEvent, source: string) => void;
  openTag?: (tag: string, toSide: boolean) => void;
  tagHover?: (tag: string, event: MouseEvent) => void;
  tagLeave?: () => void;
  rawUrl: (target: string) => string;
  files: () => string[];
  tags: () => Promise<string[]>;
  properties: () => Promise<PropertySuggestion[]>;
  propertyTypes: () => Record<string, string>;
  setPropertyType: (key: string, type: string) => Promise<Record<string, string>>;
  renderEmbed: (target: string, signal: AbortSignal) => Promise<EmbeddedNote | null>;
  embedTrail?: readonly string[];
  allowHtmlExecution?: boolean;
  /** Trusted private-note code; independent of plugin loading and text readOnly. */
  allowScriptExecution?: boolean;
  allowPlugins?: boolean;
  bindEditor?: (view: EditorView, commands: { undo: () => boolean; redo: () => boolean }) => () => void;
  mountFragment?: (host: HTMLElement, source: string, options: FragmentOptions) => () => void;
  reportError?: (message: string) => void;
}

const emptyContext: RenderContext = {
  sourcePath: '', openLink: () => {}, openMenu: () => {}, rawUrl: (target) => target,
  files: () => [], tags: async () => [], properties: async () => [],
  propertyTypes: () => ({}), setPropertyType: async () => ({}), renderEmbed: async () => null,
};
export const renderContext = Facet.define<RenderContext, RenderContext>({
  combine: (values) => values[0] ?? emptyContext,
});

export const contextOf = (view: EditorView): RenderContext => view.state.facet(renderContext);

/** Print and generated Markdown must not regain execution through nested embeds. */
export function nonExecutingContext(context: RenderContext): RenderContext {
  return { ...context, bindEditor: undefined, allowScriptExecution: false, allowPlugins: false, allowHtmlExecution: false,
    renderEmbed: async (target, signal) => {
      const note = await context.renderEmbed(target, signal);
      return note ? { ...note, context: nonExecutingContext(note.context) } : null;
    },
  };
}
