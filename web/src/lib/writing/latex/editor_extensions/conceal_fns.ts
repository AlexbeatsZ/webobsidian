// @ts-nocheck -- adapted upstream rule implementation; native boundaries are type checked.
import type { EditorView } from '@codemirror/view';
import type { ConcealSpec } from './conceal';
import { cumulativeSum } from '../utils/editor_utils';
import { EquationText } from '../utils/tokenizer';
import { getMathBoundsPlugin } from '../editor_context/mathbounds';
import { traverseTree, type MappingInfo } from './concealMacros';

export type ConcealCachedEquations = Record<string, ConcealSpec[]>;
export function conceal(
	view: EditorView,
	cached_equations: ConcealCachedEquations,
	{
		maps,
		macroMap
	}: MappingInfo
): { specs: ConcealSpec[]; cached_equations: ConcealCachedEquations } {
	const boundsPlugin = getMathBoundsPlugin(view);
	const overlays = boundsPlugin.getEquationOverlays(view.state, true);
	// get the all the lines from each overlay and their respective bounds, so that we can cache them separately
	// as concealments happen on a per-line basis. Technically an overlay should only span a single line or the full equation.
	// but on errorous syntax, the parser might not do that.
	const overlays_by_line = overlays.map((eqn) => {
		const lines = eqn.text.split("\n");
		const lines_lengths = cumulativeSum(lines.map(l => l.length + 1))
		lines_lengths.unshift(0)
		let lines_start = 0;
		return eqn.bound.overlay.map((overlay) => {
			const arr = [];
			for (;lines_start < lines_lengths.length - 1; lines_start++) {
				if (lines_lengths[lines_start]! + eqn.overlay.from >= overlay.to) break;
				// substract newline character from the end of the line, as it is not part of the overlay
				const line_end = Math.min(lines_lengths[lines_start + 1]! + eqn.overlay.from - 1, overlay.to);
				const start = Math.max(lines_lengths[lines_start]! + eqn.overlay.from, overlay.from)
				arr.push({
					text: eqn.text.slice(start - eqn.overlay.from, line_end - eqn.overlay.from),
					bound: eqn.bound,
					overlay: {
						from: start,
						to: line_end,
					},
				})
			}
			return arr
		})
	}).flat(2);
	const new_equations: typeof cached_equations = {};
	const specs: ConcealSpec[] = [];

	for (const eqn of overlays_by_line) {
		const cached = cached_equations[eqn.text];
		if (cached) {
			new_equations[eqn.text] = cached
			specs.push(
				...cached.map((specs) =>
					specs.map((spec) => ({
						...spec,
						start: spec.start + eqn.overlay.from,
						end: spec.end + eqn.overlay.from,
					})),
				),
			);
			continue;
		} else if (eqn.text.trim() === "") {
			continue;
		}
		const bound = eqn.bound;
		new_equations[eqn.text] = [];
		const localSpecs = traverseTree(
			bound.tree,
			new EquationText(eqn.text, eqn.overlay.from, eqn.overlay.to),
			{ maps, macroMap }
		);
		specs.push(...localSpecs);
		// keep cached equations relative to the overlay start such that duplicates can exists and
		// be retrieved regardless of their position in the document
		new_equations[eqn.text] = localSpecs.map((specs) =>
			specs.map((spec) => ({
				...spec,
				start: spec.start - eqn.overlay.from,
				end: spec.end - eqn.overlay.from,
			})),
		);
	}
	cached_equations = new_equations;

	return { specs, cached_equations };
}
