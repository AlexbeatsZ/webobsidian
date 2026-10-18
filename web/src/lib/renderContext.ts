import { Facet } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

export interface RenderMenuItem {
  label: string; icon?: string; onClick?: () => void;
  submenu?: RenderMenuItem[]; separator?: boolean;
}
export interface PropertySuggestion { key: string; type: string; count: number }

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
  renderEmbed: (target: string, signal: AbortSignal) => Promise<{ html: string } | null>;
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
