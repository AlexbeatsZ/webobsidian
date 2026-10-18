import { Facet } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

export interface RenderMenuItem {
  label: string; icon?: string; onClick?: () => void;
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
  openMenu: (menu: { x: number; y: number; items: RenderMenuItem[] }) => void;
  rawUrl: (target: string) => string;
  files: () => string[];
  tags: () => Promise<string[]>;
  properties: () => Promise<PropertySuggestion[]>;
  propertyTypes: () => Record<string, string>;
  setPropertyType: (key: string, type: string) => Promise<Record<string, string>>;
  renderEmbed: (target: string, signal: AbortSignal) => Promise<EmbeddedNote | null>;
  embedTrail?: readonly string[];
  allowHtmlExecution?: boolean;
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
