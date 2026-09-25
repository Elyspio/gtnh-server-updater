import { useEffect, useRef } from "react";
import { Box, Typography } from "@mui/material";
import { languageOf, monaco } from "./monaco";

const BASE_OPTIONS: monaco.editor.IStandaloneEditorConstructionOptions = {
  theme: "gtnh-dark",
  automaticLayout: true,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  fontFamily: '"IBM Plex Mono", monospace',
  fontSize: 12,
  renderWhitespace: "selection",
};

/** One read-only version of the file. */
export function ReadOnlyPane({ title, value, path, accent }: {
  title: string;
  value: string;
  path: string;
  accent: string;
}): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!host.current) return undefined;
    const editor = monaco.editor.create(host.current, {
      ...BASE_OPTIONS,
      value,
      language: languageOf(path),
      readOnly: true,
    });
    return () => editor.dispose();
  }, [value, path]);

  return (
    <Box className="editor-pane">
      <Typography variant="caption" className="editor-pane-title" sx={{ borderColor: accent }}>{title}</Typography>
      <Box ref={host} className="editor-surface" />
    </Box>
  );
}

/** Left: the reference version, read-only. Right: the result, edited in place. */
export function ResultDiffPane({ original, value, path, onChange }: {
  original: string;
  value: string;
  path: string;
  onChange(next: string): void;
}): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(onChange);
  latest.current = onChange;

  useEffect(() => {
    if (!host.current) return undefined;
    const language = languageOf(path);
    const originalModel = monaco.editor.createModel(original, language);
    const modifiedModel = monaco.editor.createModel(value, language);
    const editor = monaco.editor.createDiffEditor(host.current, {
      ...BASE_OPTIONS,
      originalEditable: false,
      readOnly: false,
      renderSideBySide: true,
      ignoreTrimWhitespace: false,
    });
    editor.setModel({ original: originalModel, modified: modifiedModel });
    const subscription = modifiedModel.onDidChangeContent(() => latest.current(modifiedModel.getValue()));
    return () => {
      subscription.dispose();
      editor.dispose();
      originalModel.dispose();
      modifiedModel.dispose();
    };
    // The models are recreated when another file or another reference version is reviewed.
  }, [original, path]);

  return <Box ref={host} className="editor-surface editor-result" />;
}
