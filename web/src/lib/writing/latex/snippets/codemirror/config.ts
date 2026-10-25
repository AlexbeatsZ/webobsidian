import { EditorView } from "@codemirror/view";
import { Facet, EditorState } from "@codemirror/state";
import { type LatexSuiteCMSettings, processLatexSuiteSettings, DEFAULT_SETTINGS } from "../../settings/settings";

const defaultSettings = processLatexSuiteSettings(DEFAULT_SETTINGS, {
    snippets: [],
    snippetVariables: {},
    rawConcealMaps: [],
    updateHandlers: [],
});
export const latexSuiteConfig = Facet.define<LatexSuiteCMSettings, LatexSuiteCMSettings>({
    combine: (input) => input[0] ?? defaultSettings,
});

export function getLatexSuiteConfig(viewOrState: EditorView | EditorState) {
    const state = viewOrState instanceof EditorView ? viewOrState.state : viewOrState;

    return state.facet(latexSuiteConfig);
}

export function getLatexSuiteConfigExtension(pluginSettings: LatexSuiteCMSettings) {
    return latexSuiteConfig.of(pluginSettings);
}
