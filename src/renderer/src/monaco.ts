import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/language/json/json.worker?worker";

/** Monaco is bundled with the app: no network, no CDN. */
self.MonacoEnvironment = {
  getWorker: (_workerId: string, label: string) => (label === "json" ? new JsonWorker() : new EditorWorker()),
};

monaco.editor.defineTheme("gtnh-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#0f1720",
    "editorGutter.background": "#0f1720",
    "diffEditor.insertedTextBackground": "#86c06c22",
    "diffEditor.removedTextBackground": "#e4a44b22",
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
