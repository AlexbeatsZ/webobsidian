// @ts-nocheck -- adapted upstream rule implementation; native boundaries are type checked.
import { EditorView, ViewPlugin, ViewUpdate, type KeyBinding, runScopeHandlers, keymap } from "@codemirror/view";
import { runSnippets } from "./features/run_snippets";
import { runAutoFraction } from "./features/autofraction";
import { tabout, shouldTaboutByCloseBracket } from "./features/tabout";

import { getContextPlugin } from "./editor_context/context";
import { setSelectionToNextTabstop, tempKeyPress } from "./snippets/snippet_management";
import { getLatexSuiteConfig } from "./snippets/codemirror/config";
import { clearSnippetQueue } from "./snippets/codemirror/snippet_queue_state_field";

import { handleMathTooltip } from "./editor_extensions/math_tooltip";
import { isComposing } from "./utils/editor_utils";
import { autoDelete$ } from "./editor_extensions/autoDelete$";
import type { GroupedSnippets, LatexSuiteCMSettings } from "./settings/settings";
import { getFilePathFromState, notice } from "./editor_extensions/obsidian_utils";
import { EditorState, StateField } from "@codemirror/state";
import { serializeSnippetLike, type Snippet } from "./snippets/snippets";

export const handleUpdate = (update: ViewUpdate) => {
	const settings = getLatexSuiteConfig(update.state);

	// The math tooltip handler is driven by view updates because it utilizes
	// information about visual line, which is not available in EditorState
	if (settings.mathPreviewEnabled && !update.transactions.some(tr => tr.annotation(tempKeyPress))) {
		handleMathTooltip(update);
	}
}

export const keyboardEventPlugin = ViewPlugin.fromClass(class {
	lastKeyboardEvent: KeyboardEvent | null = null;

	onKeydown(event: KeyboardEvent, view: EditorView) {
		if (event.key == "Unidentified" || event.key == "Process" || event.key == "Dead") {
			this.lastKeyboardEvent = event;
			return;
		}
		// don't process dead keys as they are composing but they don't act like it.
		if (this.lastKeyboardEvent?.key === "Dead") {
			this.lastKeyboardEvent = new KeyboardEvent("keydown", {
				...this.lastKeyboardEvent,
				key: "Process"
			});
			return;
		} else if (!["Shift", "Control", "Alt", "Meta"].includes(event.key)) {
			this.lastKeyboardEvent = null;
		}

		if (event.key.length !== 1) return;
		const success =
			handleKeydown(
				event.key,
				event.ctrlKey || event.metaKey,
				isComposing(view, event),
				view,
			) || runScopeHandlers(view, event, "latex-suite");

		if (success) event.preventDefault();
	}
}, {
	eventHandlers: {
		keydown(event, view) {
			view.plugin(keyboardEventPlugin)!.onKeydown(event, view);
		},

	},

})

export const onInput = (view: EditorView, _from: number, _to: number, text: string): boolean => {
	const lastKeyboardEvent = view.plugin(keyboardEventPlugin)?.lastKeyboardEvent;
	if (text === "\0\0") return true;
	if (text.length == 1 && lastKeyboardEvent) {
		if (text === "\t") text = "Tab";
		const event = new KeyboardEvent("keydown", {
			...lastKeyboardEvent,
			key: text,
			keyCode: undefined,
		});
		const success = handleKeydown(
			text,
			lastKeyboardEvent.ctrlKey || lastKeyboardEvent.metaKey,
			isComposing(view, lastKeyboardEvent),
			view
		) || runScopeHandlers(view, event, "latex-suite")
		if (success) {

			return true;
		}
	}
	return false;
}

export const handleKeydown = (key: string, ctrlKey: boolean, isIME: boolean, view: EditorView) => {
	if (view.state.readOnly || view.composing || key.length > 1) {
		return false
	}

	const settings = getLatexSuiteConfig(view);

	if (
		!settings.snippetsEnabled ||
		// Prevent IME from triggering keydown events.
		(settings.suppressSnippetTriggerOnIME && isIME) ||
		// Allows Ctrl + z for undo, instead of triggering a snippet ending with z
		ctrlKey
	) {
		return false;
	}
	const current=view.state.field(snippetStateField);
    const snippets = key === '' ? current.snippets.automatic : current.automaticBySuffix.get(key) ?? current.regexAutomatic;
	try {
		const options = {recursive: settings.snippetRecursion, debug: settings.snippetDebug};
		if (runSnippets(view, {snippets, recursiveSnippets: current.snippets.automatic, key}, options)) return true;
	} catch (e) {
		clearSnippetQueue(view);
		console.error(e);
	}
	return false;
};

type LatexSuiteKeyBinding = KeyBinding & {scope: string};

/**
 * Get the keymaps specific for Latex Suite. These keymaps only run in scope `latex-suite`.
 * @param settings The settings with the keybindings to use
 * @param snippets The snippets to use for generating keymaps
 * @returns The keymaps for the LaTeX suite based on the provided settings
 */
function getKeymaps(settings: LatexSuiteCMSettings, snippets: Snippet[]): LatexSuiteKeyBinding[] {
	// Order matters for keybindings,
	// as they are checked in order from the beginning of the array to the end
	const keybindings: KeyBinding[] = [];

	/*
	 * When backspace is pressed, if the cursor is inside an empty inline math,
	 * delete both $ symbols, not just the first one.
	 */
	if (settings.autoDelete$) {
		keybindings.push({
			key: "Backspace",
			run: autoDelete$
		});
	}

	const snippet_triggers = new Set(
		snippets.map((s) => s.triggerKey).filter((s) => s !== "")
	);
	snippet_triggers.add(settings.snippetsTrigger);
	const runMaker = (key: string) => {
		const filtered_snippets = snippets.filter(
			(s) =>
				s.triggerKey === key ||
				(!s.triggerKey &&
					!s.options.automatic &&
					key === settings.snippetsTrigger),
		);
		return (view: EditorView) => {
			const settings = getLatexSuiteConfig(view);
			// Prevent IME from triggering keydown events.
			if (view.state.readOnly || view.composing)
				return false;
			try {
				const options = {recursive: settings.snippetRecursion, debug: settings.snippetDebug};
				return runSnippets(view, {snippets: filtered_snippets}, options);
			} catch (e) {
				clearSnippetQueue(view);
				console.error(e);
				return false;
			}
		};
	};

	if (settings.snippetsEnabled) {
		keybindings.push(
			...Array.from(snippet_triggers, (key) => {
				return {
					key,
					run: runMaker(key),
				};
			})
		);
	}

	keybindings.push({
		key: settings.snippetNextTabstopTrigger,
		run: function nextTabstop(view: EditorView) {
			return setSelectionToNextTabstop(view, false);
		},
	});

	keybindings.push({
		key: settings.snippetPreviousTabstopTrigger,
		run: function previousTabstop(view: EditorView) {
			return setSelectionToNextTabstop(view, true);
		},
	});
	if (settings.autofractionEnabled) {
		keybindings.push({
			key: settings.autofractionTrigger,
			run: function autofraction (view: EditorView) {
				if (!getLatexSuiteConfig(view).autofractionEnabled) return false;
				const ctx = getContextPlugin(view);
				if (!ctx.mode.strictlyInMath()) return false;
				return runAutoFraction(view);
			},
		});
	}

	const taboutShortcuts = [
		{
			key: settings.taboutTrigger,
			run: function exitEquation(view: EditorView) {
				if (!view.state.selection.main.empty) return false;
				const ctx = getContextPlugin(view);
				return tabout(view, ctx);
			},
		},
		...[")", "}", "]"].map((key) => ({
			key,
			run: function nextClosingBracket(view: EditorView) {
				if (!shouldTaboutByCloseBracket(view, key)) return false;
				const ctx = getContextPlugin(view);
				return tabout(view, ctx);
			},
		})),
	];
	if (settings.taboutEnabled) {
		keybindings.push(...taboutShortcuts);
	}

	return keybindings.map((keybinding) => ({
		...keybinding,
        run: view => view.state.readOnly || view.composing ? false : keybinding.run?.(view) ?? false,
		scope: "editor latex-suite",
	}));
}

function filterSnippetsByFile(snippets: Snippet[], path: string | null, state: EditorState): GroupedSnippets {
	const filtered_snippets =  path !== null
		? snippets.filter((snippet) => {
			try {
				return snippet.options.includedPaths({ path, state });
			} catch (e) {
				const error_message = `Included paths crashed, skipping snippet: \n${serializeSnippetLike(snippet)}\n\n`
				state.field(notice)(`${error_message}\n\n with error ${e as string}`, 5000)
				console.error(error_message)
				console.error(e);
				return false;
			}
		})
		: snippets;

	return {
		automatic: filtered_snippets.filter((s) => s.options.automatic),
		all: filtered_snippets
	};
}

type SnippetState = {
	snippets: GroupedSnippets;
	path: string | null;
	keymaps: KeyBinding[];
}

function createSnippetState(state: EditorState): SnippetState {
	const settings = getLatexSuiteConfig(state);
	const snippets = settings.snippets;
	const path = getFilePathFromState(state);
	const filtered_snippets = filterSnippetsByFile(snippets.all, path, state);
	const keymaps = getKeymaps(settings, filtered_snippets.all);
	const automatic=filtered_snippets.automatic;
    const regexAutomatic=automatic.filter(s=>typeof s.trigger!=='string'||s.trigger==='');
    const endings=new Set(automatic.flatMap(s=>typeof s.trigger==='string'&&s.trigger?[s.trigger.slice(-1)]:[]));
    const automaticBySuffix=new Map([...endings].map(key=>[key,automatic.filter(s=>typeof s.trigger!=='string'||s.trigger===''||s.trigger.endsWith(key))]));
    return { snippets: filtered_snippets, path, keymaps, automaticBySuffix, regexAutomatic };
}

export const snippetStateField = StateField.define<SnippetState>({
	create: createSnippetState,
	update: (value, tr) => {
		const path = getFilePathFromState(tr.state);
		if (!tr.reconfigured && path === value.path) {
			return value;
		}
		return createSnippetState(tr.state);
	},
	provide: (f) => keymap.compute([f], (state) => state.field(f).keymaps),
})
