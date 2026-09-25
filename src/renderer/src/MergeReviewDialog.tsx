import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import type { MergeDocument, MergeFileEntry } from "@shared/merge.types";
import { CONFLICT_START, KIND_LABELS, hasConflictMarkers } from "@shared/merge-model";
import { ReadOnlyPane, ResultDiffPane } from "./MonacoPanes";

type Reference = "new" | "old" | "base";

type Props = {
  file: MergeFileEntry;
  document?: MergeDocument;
  busy: boolean;
  onClose(): void;
  onDecide(action: "keep-new" | "take-old"): void;
  onWrite(lines: string[]): void;
};

const REFERENCE_LABELS: Record<Reference, string> = {
  new: "New version",
  old: "Your version",
  base: "Original archive",
};

/** Review with the VS Code editor: the three versions, then the result compared to one of them. */
export function MergeReviewDialog({ file, document, busy, onClose, onDecide, onWrite }: Props): React.JSX.Element {
  const text = document?.contentKind === "text" ? document : undefined;
  const [result, setResult] = useState("");
  const [reference, setReference] = useState<Reference>("new");

  useEffect(() => setResult(text?.merged ?? ""), [text?.merged]);

  const unresolved = hasConflictMarkers(result);

  return (
    <Dialog open fullScreen onClose={onClose}>
      <DialogTitle sx={{ pb: 1 }}>
        <Stack direction="row" spacing={2} alignItems="center">
          <Typography className="path-code" sx={{ flex: 1, wordBreak: "break-all" }}>{file.path}</Typography>
          <Chip size="small" label={KIND_LABELS[file.kind]} />
          {text && text.conflictCount > 0 && <Chip size="small" color="warning" label={`${text.conflictCount} conflicts`} />}
        </Stack>
      </DialogTitle>
      <DialogContent dividers className="review-content">
        {document && document.contentKind !== "text" && (
          <Alert severity="info">
            {describeWholeFile(document.contentKind)} Old: {document.oldSize} bytes, new: {document.newSize} bytes.
          </Alert>
        )}
        {!document && <Typography color="text.secondary">Loading…</Typography>}
        {text && (
          <Stack spacing={1} sx={{ height: "100%" }}>
            <Stack direction="row" spacing={1} className="review-panes">
              <ReadOnlyPane title="Original archive" value={text.base} path={file.path} accent="#8a94a6" />
              <ReadOnlyPane title="Your version" value={text.old} path={file.path} accent="#86c06c" />
              <ReadOnlyPane title="New version" value={text.new} path={file.path} accent="#64a0e6" />
            </Stack>

            <Stack direction="row" spacing={2} alignItems="center">
              <Typography variant="subtitle2">Result to write</Typography>
              <ToggleButtonGroup
                size="small"
                exclusive
                value={reference}
                onChange={(_event, value: Reference | null) => value && setReference(value)}
              >
                {(Object.keys(REFERENCE_LABELS) as Reference[]).map((option) => (
                  <ToggleButton key={option} value={option}>Compare with {REFERENCE_LABELS[option].toLowerCase()}</ToggleButton>
                ))}
              </ToggleButtonGroup>
              <Button size="small" onClick={() => setResult(text.merged)}>Reset to pre-merge</Button>
              <Button size="small" onClick={() => setResult(text.old)}>Fill with yours</Button>
              <Button size="small" onClick={() => setResult(text.new)}>Fill with new</Button>
            </Stack>

            {unresolved && (
              <Alert severity="warning" sx={{ py: 0 }}>
                Conflict markers are still there ({CONFLICT_START}). Keep the lines you want and delete the markers.
              </Alert>
            )}
            <ResultDiffPane original={text[reference]} value={result} path={file.path} onChange={setResult} />
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        <Button disabled={busy} onClick={() => onDecide("keep-new")}>Keep new version</Button>
        <Button disabled={busy} onClick={() => onDecide("take-old")}>Take your whole file</Button>
        {text && (
          <Button variant="contained" disabled={busy || unresolved} onClick={() => onWrite(result.split("\n"))}>
            Use this result
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

function describeWholeFile(kind: Exclude<MergeDocument["contentKind"], "text">): string {
  if (kind === "binary") return "Binary file: choose the whole file.";
  if (kind === "large") return "File larger than 2 MiB: choose the whole file.";
  return "File is not valid UTF-8 text: choose the whole file.";
}
