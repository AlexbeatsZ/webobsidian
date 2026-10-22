import { EditorState, Facet, StateField } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { renderContext } from '../../../renderContext';
export const createElement = (name: keyof HTMLElementTagNameMap) => document.createElement(name);
export const isMacOS = () => /Mac|iPhone|iPad/.test(navigator.platform);
export const cmDarkClass = '.theme-dark & ';
export const cmLightClass = '.theme-light & ';
export const notice = StateField.define<(message: string | DocumentFragment, timeout: number) => void>({
  create: (state) => (message) =>
    state
      .facet(renderContext)
      .reportError?.(typeof message === 'string' ? message : (message.textContent ?? '')),
  update: (value) => value,
});
export function showSnippetInfo(state: EditorState, snippet: unknown, replacement: string) {
  state.field(notice)(`Snippet: ${replacement}`, 5000);
  console.debug(snippet);
}
export const fileConfig = Facet.define<
  { getFile: () => { path: string } | null },
  { getFile: () => { path: string } | null }
>({
  combine: (input) => input[0] ?? { getFile: () => null },
});
export const getFileConfig = (input: EditorView | EditorState) =>
  (input instanceof EditorView ? input.state : input).facet(fileConfig);
export const getFileConfigExtension = (getFile: () => { path: string } | null) => fileConfig.of({ getFile });
export const getFilePathFromState = (state: EditorState) =>
  state.facet(renderContext).sourcePath || getFileConfig(state).getFile()?.path || null;
