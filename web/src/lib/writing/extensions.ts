import { Compartment, EditorState, Prec } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import { subscribeWriting, writingCMSettings, ensureWriting } from './config';
import { latexSuiteConfig } from './latex/snippets/codemirror/config';
import { mathBoundsPlugin } from './latex/editor_context/mathbounds';
import { contextPlugin } from './latex/editor_context/context';
import {
  keyboardEventPlugin,
  onInput,
  snippetStateField,
  handleUpdate,
  handleKeydown,
} from './latex/latex_suite';
import { snippetExtensions } from './latex/snippets/codemirror/extensions';
import { notice } from './latex/editor_extensions/obsidian_utils';
import {
  colorPairedBracketsPluginLowestPrec,
  highlightCursorBracketsExtension,
} from './latex/editor_extensions/highlight_brackets';
import { highlight_dollar_extension } from './latex/editor_extensions/highlight_dollar';
import { mkConcealPlugin } from './latex/editor_extensions/conceal';
import { mathTooltipExtension } from './latex/editor_extensions/math_tooltip';
import { formatPaste } from './format';
import { contextOf } from '../renderContext';
import { writingOperation } from './editing';

export function nativeWritingExtensions() {
  const config = new Compartment(),
    visuals = new Compartment();
  const display = () => {
    const c = writingCMSettings();
    return [
      c.colorPairedBracketsEnabled ? colorPairedBracketsPluginLowestPrec : [],
      c.highlightCursorBracketsEnabled ? highlightCursorBracketsExtension : [],
      c.highlightDollarEnabled ? highlight_dollar_extension : [],
      c.concealEnabled ? mkConcealPlugin() : [],
    ];
  };
  const lifecycle = ViewPlugin.fromClass(
    class {
      private alive = true;
      private stop: () => void;
      constructor(readonly view: EditorView) {
        this.stop = subscribeWriting(() =>
          queueMicrotask(() => {
            if (this.alive)
              view.dispatch({
                effects: [
                  config.reconfigure(latexSuiteConfig.of(writingCMSettings())),
                  visuals.reconfigure(display()),
                ],
              });
          }),
        );
        void ensureWriting().catch((error) => contextOf(view).reportError?.(String(error)));
      }
      destroy() {
        this.alive = false;
        this.stop();
      }
    },
  );
  return [
    config.of(latexSuiteConfig.of(writingCMSettings())),
    mathBoundsPlugin,
    contextPlugin,
    notice,
    EditorState.allowMultipleSelections.of(true),
    Prec.high(keyboardEventPlugin),
    Prec.high(EditorView.inputHandler.of(onInput)),
    Prec.high(snippetStateField),
    snippetExtensions,
    mathTooltipExtension,
    visuals.of(display()),
    lifecycle,
    EditorView.updateListener.of((update) => {
      // Preview computations may dispatch effects; run after CM has completed this update.
      if (update.view.composing || update.state.readOnly) return;
      const state = update.state;
      queueMicrotask(() => {
        if (update.view.state === state && update.view.dom.isConnected) handleUpdate(update);
      });
    }),
    EditorView.domEventHandlers({
      compositionend(_event, view) {
        const config = writingCMSettings();
        if (config.suppressSnippetTriggerOnIME && !config.snippetIMEVersion) return false;
        setTimeout(() => {
          if (view.dom.isConnected && !view.composing && !view.state.readOnly)
            handleKeydown('', false, false, view);
        }, 0);
        return false;
      },
      paste(event, view) {
        if (view.state.readOnly || view.composing || !event.clipboardData) return false;
        const text = event.clipboardData.getData('text/plain');
        if (!text) return false;
        const sel = view.state.selection.main;
        const line = view.state.doc.lineAt(sel.from).text;
        try {
          const result = formatPaste(
            text,
            contextOf(view).sourcePath,
            line,
            view.state.sliceDoc(sel.from, sel.to),
          );
          if (result === text) return false;
          event.preventDefault();
          view.dispatch({
            ...view.state.replaceSelection(result),
            annotations: writingOperation.of('paste'),
            userEvent: 'input.paste',
          });
          return true;
        } catch (error) {
          contextOf(view).reportError?.(String(error));
          return true;
        }
      },
    }),
  ];
}
