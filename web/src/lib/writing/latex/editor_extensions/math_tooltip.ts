import { type Tooltip, showTooltip, EditorView } from '@codemirror/view';
import { StateField, type EditorState } from '@codemirror/state';
import { renderMath, mathDefinitionContext, subscribeMathConfiguration } from '../../../mathjax';
import { syntaxModel } from '../../../syntaxModel';
import { contextOf, renderContext } from '../../../renderContext';
import { decorationInputsChanged } from '../../../decorationDependencies';
import { mathPreview, mathPreviewTex, PREVIEW_HIGHLIGHT_CLASS as HIGHLIGHT_CLASS } from '../editor_context/mathPresentation';
import { getLatexSuiteConfig } from '../snippets/codemirror/config';
import { cmDarkClass, cmLightClass } from './obsidian_utils';
import { mathSyntaxHighlighting } from './math_highlight';

interface MathTooltip { equation: string; from: number; to: number; definitions: readonly string[]; sourcePath?: string; tooltip: Tooltip }
export const cursorTooltipField = StateField.define<readonly MathTooltip[]>({
  create(state) { const tooltip = inlineTooltip(state); return tooltip ? [tooltip] : []; },
  update(value, tr) {
    if (!decorationInputsChanged(tr)) return value;
    const next = inlineTooltip(tr.state), current = value[0];
    if (!next) return value.length ? [] : value;
    if (current && next.equation === current.equation && next.from === current.from && next.to === current.to &&
      next.sourcePath === current.sourcePath && next.tooltip.above === current.tooltip.above &&
      next.definitions.length === current.definitions.length && next.definitions.every((d, i) => d === current.definitions[i])) return value;
    return [next];
  },
  provide: field => showTooltip.computeN([field], state => state.field(field).map(t => t.tooltip)),
});

function inlineTooltip(state: EditorState): MathTooltip | undefined {
  const preview = mathPreview(state);
  if (preview?.placement !== 'inline') return;
  const region = preview.region, equation = mathPreviewTex(state, region);
  const context = state.facet(renderContext), source = context.mathSource;
  const model = source?.model ?? state.field(syntaxModel);
  const definitions = mathDefinitionContext(model, region.from + (source?.from ?? 0));
  const above = getLatexSuiteConfig(state).mathPreviewPositionIsAbove;
  return { equation, from: region.from, to: region.to, definitions, sourcePath: context.sourcePath, tooltip: {
    pos: above ? region.from : region.to, above, strictSide: true, arrow: true,
    create(view) {
      const dom = document.createElement('div');
      dom.className = 'cm-tooltip-cursor ' + (above ? 'cm-tooltip-above' : 'cm-tooltip-below');
      const body = document.createElement('div'); body.className = 'cm-math-tooltip-body';
      body.textContent = region.tex; dom.appendChild(body);
      let controller = new AbortController();
      const render = () => {
        controller.abort(); controller = new AbortController();
        const signal = controller.signal;
        view.requestMeasure({ key: dom, read: () => {
          if (signal.aborted || !dom.isConnected) return;
          // Keep the CM-owned arrow/positioning root intact when SVG is adopted.
          void renderMath(body, equation, false, signal, {
            transient: true, sourcePath: contextOf(view).sourcePath, definitions, container: view.contentDOM,
          }).catch(error => { if (!signal.aborted) { body.textContent = region.tex; dom.title = String(error); } });
        } });
      };
      let stop = () => {};
      return { dom, mount() { stop = subscribeMathConfiguration(render); render(); },
        destroy() { controller.abort(); stop(); } };
    },
  } };
}

export const cursorTooltipBaseTheme = EditorView.baseTheme({
	".cm-tooltip.cm-tooltip-cursor": {
		backgroundColor: "var(--background-secondary)",
		color: "var(--text-normal)",
		border: "1px solid var(--background-modifier-border-hover)",
		padding: "4px 6px",
		borderRadius: "6px",
		fontFamily: "var(--font-text)",
		fontSize: "var(--font-text-size)",
		lineHeight: "var(--line-height-normal)",
		textIndent: "0",
		display: "flex",
		flexDirection: "column",
		width: "max-content",
		maxWidth: "min(32em, calc(100vw - 16px))",
		minWidth: "0",
		"& .cm-tooltip-arrow:before": {
			borderTopColor: "var(--background-modifier-border-hover)",
			borderBottomColor: "var(--background-modifier-border-hover)",
		},
		"& .cm-tooltip-arrow:after": {
			borderTopColor: "var(--background-secondary)",
			borderBottomColor: "var(--background-secondary)",
		},
		"& p": {
			margin: "0px",
		},
		"& mjx-container[jax=SVG]": {
			padding: "2px !important",
		},
		"& > .cm-math-tooltip-body": {
			minWidth: "0",
			minHeight: "0",
			maxHeight: "min(20em, 50vh)",
			overflow: "auto",
		},
	},
	[`.${HIGHLIGHT_CLASS}`]: {
		backgroundColor: "var(--text-selection)",
	},
	[`${cmDarkClass} .cm-tooltip.cm-tooltip-cursor`]: {
		boxShadow: "0 1px 2px rgb(0 0 0 / 10%), 0 3.4px 6.7px rgb(0 0 0 / 15%), 0 0 30px rgb(0 0 0 / 27%)"
	},
	[`${cmLightClass} .cm-tooltip.cm-tooltip-cursor`]: {
		boxShadow: "0 1px 2px rgb(0 0 0 / 2.8%), 0 3.4px 6.7px rgb(0 0 0 / 4.2%), 0 5px 20px rgb(0 0 0 / 7%)",
	},

});

export const mathTooltipExtension = [
  cursorTooltipField,
  cursorTooltipBaseTheme,
];

/** Safe native visuals; this does not install snippets, user code or plugin processors. */
export const mathEditingExtensions = [mathTooltipExtension, mathSyntaxHighlighting];
