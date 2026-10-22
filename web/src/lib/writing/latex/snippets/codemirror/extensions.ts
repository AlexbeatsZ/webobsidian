// @ts-nocheck -- adapted upstream rule implementation; native boundaries are type checked.
import { snippetQueuePlugin } from "./snippet_queue_state_field";
import { tabstopTheme, tabstopsStateField } from "./tabstops_state_field";

export const snippetExtensions = [
    tabstopsStateField,
	snippetQueuePlugin,
	tabstopTheme
];
