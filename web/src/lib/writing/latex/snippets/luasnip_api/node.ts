// @ts-nocheck -- adapted upstream rule implementation; native boundaries are type checked.
import { compileReplacement, expandReplacement } from "@webobsidian/markdown-core";
import { VISUAL_SNIPPET_MAGIC_SELECTION_PLACEHOLDER } from "../snippets"
import type { TabstopSpec } from "../tabstop"

type Captures = {match: string[], groups: Record<string, string>, whole?: string, before?: string, after?: string}

export type Options = {
	captures: Captures,
}
export const emptyInsertOptions: Options = {
	captures: {match: [], groups: {}},
}

export type ResultInsert = {
	insert: string;
	tabstops: readonly TabstopSpec[]
}

export class BaseNode {
	constructor(
		public insert: string | ((context: Options) => string | BaseNode[]),
		public tabstops: readonly TabstopSpec[] = [],
	) {}


	applyInsert(options: Options = emptyInsertOptions): ResultInsert {
		if (typeof this.insert === "string") {
			return { insert: this.insert, tabstops: this.tabstops };
		}
		const result = this.insert(options);
		if (typeof result === "string") {
			return { insert: result, tabstops: this.tabstops };
		}

		let offset = 0;
		const tabstopResults = result
			.map((node) => node.applyInsert(options))
			.map(({ insert, tabstops }) => {
				const currentOffset = offset;
				offset += insert.length;
				return {
					insert,
					tabstops: [
						...tabstops.map((ts) => ({
							...ts,
							from: ts.from + currentOffset,
							to: ts.to + currentOffset,
						})),
						...this.tabstops.map((ts) => ({
							...ts,
							from: ts.from + currentOffset,
							to: ts.to + currentOffset,
						})),
					],
				};
			});
		const insert = tabstopResults.map((r) => r.insert).join("");
		const tabstops = tabstopResults.flatMap((r) => r.tabstops);
		return { insert, tabstops };
	}

}

export class TextNode extends BaseNode {
	constructor(text: string) {
		super(text);
	}
}

export class TabstopNode extends BaseNode {
	constructor(index: number, insert: string = "") {
		super(insert, [{index: [index], from: 0, to: insert.length}]);
	}
}

export class CaptureNode extends BaseNode {
	constructor(key: number | string, defaultValue: string = "") {
		if (typeof key === "number") {
			super(({captures}) => captures.match[key] ?? defaultValue);
		} else if (typeof key === "string") {
			super(({captures}) => captures.groups[key] ?? defaultValue);
		}
	}
}

export type Replacement = {
	start: number,
	end: number,
	replacement: string
}
export function applyReplacements(str: string, replacements: Replacement[]): string {
	replacements.sort((a, b) => a.start - b.start);
	let offset = 0;
	const str_arr: string[] = []
	for (const {start, end, replacement} of replacements) {
		str_arr.push(str.slice(offset, start), replacement);
		offset = end;
	}
	return str_arr.join("") + str.slice(offset);
}

/**
 * @todo fix nested snippets in tabstop management as its currently broken when reversing.
 */
export class SnippetNode extends BaseNode {
	constructor(private index: number, private nodes: BaseNode[]) {
		super("", []);
	}

	override applyInsert(options: Options = emptyInsertOptions): ResultInsert {
		const result = new ArrayNode(this.nodes).applyInsert(options);
		const super_tabstop = {index: [this.index], from: 0, to: result.insert.length}
		const final_result: ResultInsert = {
			insert: result.insert,
			tabstops: [
				super_tabstop,
				...result.tabstops.map((ts) => ({
					...ts,
					index: [this.index, ...ts.index],
				})),
			],
		};
		return final_result
	}
}

export class SnippetStringNode extends BaseNode {
  private template;
  constructor(snippet: string) {
    super((options) => this.parseSnippet(options.captures));
    this.template = compileReplacement(snippet);
  }
  parseSnippet(captures: Captures): BaseNode[] {
    const result = expandReplacement(this.template, {
      captures: captures.match, groups: captures.groups,
      match: captures.whole, get before() { return captures.before; }, get after() { return captures.after; },
      visual: captures.groups[VISUAL_SNIPPET_MAGIC_SELECTION_PLACEHOLDER],
      visualOriginal: captures.groups['${VISUAL_ORIGINAL}'],
    }, true);
    return [new BaseNode(result.text, result.tabstops.map(ts => ({...ts, index: [ts.index]})))];
  }
}

export class VisualSnippetNode extends SnippetStringNode {
  override parseSnippet(captures: Captures): BaseNode[] {
    if (captures.groups[VISUAL_SNIPPET_MAGIC_SELECTION_PLACEHOLDER] === undefined)
      throw new Error('Visual snippet requires selected text');
    return super.parseSnippet(captures);
  }
}
export class SnippetTabstopOnlyNode extends BaseNode {
	constructor(snippet: string) {
		super(() => new SnippetStringNode(snippet).parseSnippet({match: [], groups: {}}));
	}
}

// Discourage to nest array nodes this way and a way to normalize tabstops indexes at the end.
export class ArrayNode {
	constructor(private children: BaseNode[]) {}

	applyInsert(options: Options = emptyInsertOptions): ResultInsert {
		return new BaseNode(() => this.children).applyInsert(options);
	}

}
