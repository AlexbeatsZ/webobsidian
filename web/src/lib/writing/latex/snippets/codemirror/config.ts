// @ts-nocheck -- adapted upstream rule implementation; native boundaries are type checked.
import { EditorView } from "@codemirror/view";
import { Facet, EditorState } from "@codemirror/state";
import { type LatexSuiteCMSettings, processLatexSuiteSettings, DEFAULT_SETTINGS } from "../../settings/settings";

// Facet.define calls combine([]) immediately, while the settings module may
// still be loading through the math-context/conceal import cycle.
export const latexSuiteConfig = Facet.define<LatexSuiteCMSettings, LatexSuiteCMSettings | undefined>({
    combine: (input) => input[0],
});
let fallbackSettings: LatexSuiteCMSettings | undefined;

export function getLatexSuiteConfig(viewOrState: EditorView | EditorState) {
    const state = viewOrState instanceof EditorView ? viewOrState.state : viewOrState;

    return state.facet(latexSuiteConfig) ?? (fallbackSettings ??= processLatexSuiteSettings(DEFAULT_SETTINGS, {
        snippets: [],
        snippetVariables: {},
        rawConcealMaps: [],
        updateHandlers: [],
    }));
}

export function getLatexSuiteConfigExtension(pluginSettings: LatexSuiteCMSettings) {
    return latexSuiteConfig.of(pluginSettings);
}
