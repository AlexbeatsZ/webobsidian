// @ts-nocheck -- adapted upstream snippet node API.
import type { MathlessMacroArgs } from "../../editor_context/default_text_areas";
import type { SnippetVariables } from "../parse";
import { mathCommandNames } from '../../../../mathjax';
import { ArrayNode, BaseNode, CaptureNode, SnippetStringNode, TabstopNode, TextNode } from "./node";
import type { UpdateHandler } from "../../api";

// For now SnippetNode, VisualSnippetNode and ArrayNode remain internal api only,
// as I am not sure how bug proof it would be/how intuitif.
// And its not really needed as they are just shortcuts of using tabstop and text nodes + a function.

function tabstop_node(index: number, insert: string = "") {
	return new TabstopNode(index, insert);
}

function text_node(text: string) {
	return new TextNode(text)
}

/**
 * Creates a node that inserts the text captured by a regex group. ${VISUAL} is reserved for visual snippets.
 * @param captureName key or number
 * @returns node that inserts the captured node
 */
function capture_node(captureName: string | number, defaultValue: string="") {
	return new CaptureNode(captureName, defaultValue);
}

function snippet_node(snippet: string) {
	return new SnippetStringNode(snippet);
}

function array_node(nodes: BaseNode[]) {
	return new ArrayNode(nodes);
}
export type PluginSnippetApi = {
  commandNames?: readonly string[];
	addRawConcealMaps: (maps: Record<string, unknown>) => void;
	addMathlessMacros: (macros: MathlessMacroArgs) => void;
	addUpdateHandler: (handler: UpdateHandler) => void;
}

export const api = (snippetVariables: SnippetVariables, pluginApi: PluginSnippetApi) => {
	const ALL_MACROS = [...(pluginApi.commandNames ?? mathCommandNames())];
	let prefixNames = [...new Set(ALL_MACROS)].sort(), prefixLength = ALL_MACROS.length;
	const hasMacroPrefix = (prefix: string) => {
		if (prefixLength !== ALL_MACROS.length) { prefixNames = [...new Set(ALL_MACROS)].sort(); prefixLength = ALL_MACROS.length; }
		const names = prefixNames;
		let lo = 0, hi = names.length;
		while (lo < hi) { const mid = (lo + hi) >>> 1; if (names[mid] < prefix) lo = mid + 1; else hi = mid; }
		return names[lo]?.startsWith(prefix) ?? false;
	};
	return {
		hasMacroPrefix,
		snippetVariables,
		tabstop_node,
		text_node,
		capture_node,
		ALL_MACROS,
		...pluginApi,
	}
}

export const snippetApi = {
	tabstop_node,
	text_node,
	capture_node,
	snippet_node,
	array_node,
	get ALL_MACROS() { return mathCommandNames(); },
}
