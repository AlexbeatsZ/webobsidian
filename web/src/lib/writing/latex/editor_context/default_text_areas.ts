// @ts-nocheck -- adapted upstream rule implementation; native boundaries are type checked.
import * as v from "valibot"
import { mathBaseArguments } from '@webobsidian/markdown-core';
const MacroArgsSchema = v.object({
	name: v.string(),
	arguments: v.optional(v.array(v.number())),
});
export type MacroArgs = v.InferOutput<typeof MacroArgsSchema>;

export const MacroArgsPipeSchema = v.pipe(
		v.optional(v.array(v.union([v.string(), MacroArgsSchema])), []),
		v.mapItems((item) => (typeof item === "string" ? { name: item, arguments: [0] } : item)),
)
/**
 * List of environments where math commands are illegal to insert and where the environment is latex text instead.
 * Macros should only take up the arguments they actually take to avoid seeing `$\text{world}{\color{red}\alpha}$` the second argument of `text` as an argument of `text`.
 */
export const textMacroArgs = [
  ...Object.entries(mathBaseArguments).flatMap(([name, args]) => {
    const arguments_ = args.flatMap((kind, i) => kind === 'text' ? [i] : []);
    return arguments_.length ? [{ name, arguments: arguments_ }] : [];
  }),
] as const satisfies readonly MacroArgs[];

/**
 * List of environments where math commands are illegal to insert.
 * Here treating them as text also doesn't make sense so autocomplete/snippets are disabled for them.
 * Snippets with `includedMacros` can expand in these.
 */
export const restrictedMacroArgs = [
  ...Object.entries(mathBaseArguments).flatMap(([name, args]) => {
    const arguments_ = args.flatMap((kind, i) => kind === 'literal' ? [i] : []);
    return arguments_.length ? [{ name, arguments: arguments_ }] : [];
  }),
] as const satisfies readonly MacroArgs[];


export const DEFAULT_MATHLESS_ARGS: MathlessMacroArgs = {
	text: [],
	restricted: [{ name: "operatorname", arguments: [0] }],
};
export const EMPTY_MATHLESS_ARGS: MathlessMacroArgs = {text: [], restricted: []};
export const mathlessArgsSchema = v.object({
	text: v.optional(MacroArgsPipeSchema, []),
	restricted: v.optional(MacroArgsPipeSchema, []),
});
export type MathlessMacroArgs = v.InferOutput<typeof mathlessArgsSchema>;
/**
 * List of math fonts/ math commands. I don't know if they should treated as text since they are technically math environments.
 */
const mathFonts = [
	"label", // labels don't work properly in mathjax. See https://physics.meta.stackexchange.com/questions/5396/using-labels-with-mathjax,
	// but labels can't be overwritten and everytime the equation is changed the label gets recompiled and the reference is lost till obsidian reloads itself.
	"ref", // math is allowed for some reason
	"eqref", // math is allowed for some reason
	"operatorname",
	"operatorname*",
	"DeclareMathOperator",
	"DeclareMathOperator*",
	"mathrm",
	"mathup",
	"mathnormal",
	"mathbf",
	"mathbfup",
	"mathit",
	"mathbfit",
	"mathbb",
	"Bbb",
	"mathfrak",
	"mathbffrak",
	"mathscr",
	"mathbfscr",
	"mathsf",
	"mathsfup",
	"mathbfsf",
	"mathbfsfup",
	"mathsfit",
	"mathbfsfit",
	"mathtt",
	"mathcal",
	"mathbfcal",
	"symrm",
	"symup",
	"symnormal",
	"symbf",
	"symbfup",
	"symit",
	"symbfit",
	"symbb",
	"symfrak",
	"symbffrak",
	"symscr",
	"symbfscr",
	"symsf",
	"symsfup",
	"symbfsf",
	"symbfsfup",
	"symsfit",
	"symbfsfit",
	"symtt",
	"symcal",
	"symbfcal",
	"Bbb",
] as const;

export const mathFontsEnvsRaw = `[${mathFonts.map(env => `\n\t["${env}", "}"]`).join("")}\n]`;
