import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/language/json/json.worker?worker";
import { ink } from "./theme";

/** Monaco is bundled with the app: no network, no CDN. */
self.MonacoEnvironment = {
	getWorker: (_workerId: string, label: string) => (label === "json" ? new JsonWorker() : new EditorWorker()),
};

monaco.editor.defineTheme("gtnh-sheet", {
	base: "vs",
	inherit: true,
	rules: [],
	colors: {
		"editor.background": "#ffffff",
		"editorGutter.background": ink.paper,
		"editorLineNumber.foreground": ink.rule,
		"editorLineNumber.activeForeground": ink.ink,
		"editor.lineHighlightBackground": "#eef3f6",
		"diffEditor.insertedTextBackground": "#2f7a4b22",
		"diffEditor.removedTextBackground": "#b35f0022",
	},
});

/** GTNH ships Forge .cfg, properties, JSON and shell files. */
export function languageOf(path: string): string {
	const name = path.toLowerCase();
	if (name.endsWith(".json")) return "json";
	if (name.endsWith(".sh") || name.endsWith(".bash")) return "shell";
	if (name.endsWith(".bat")) return "bat";
	if (name.endsWith(".xml")) return "xml";
	if (name.endsWith(".md")) return "markdown";
	if (name.endsWith(".cfg") || name.endsWith(".conf") || name.endsWith(".properties") || name.endsWith(".ini")) return "ini";
	return "plaintext";
}

export { monaco };
