import { useEffect, useState } from "react";
import { Box, Button, Checkbox, Chip, Stack, Typography } from "@mui/material";
import type { MergeDecision, MergeFileEntry, MergeFileKind } from "@shared/merge.types";
import { KIND_LABELS, groupByDirectory } from "@shared/merge-model";

type Props = {
  files: MergeFileEntry[];
  decisions: Map<string, MergeDecision>;
  busy: boolean;
  onDecide(path: string, action: "keep-new" | "take-old"): void;
  onDecideGroup(files: MergeFileEntry[], action: "keep-new" | "take-old"): void;
  onOpen(file: MergeFileEntry): void;
};

const KIND_COLORS: Record<MergeFileKind, "primary" | "warning" | "success" | "default"> = {
  "user-modified": "primary",
  conflict: "warning",
  "user-added": "success",
  "removed-by-new": "default",
  "mod-added": "default",
  regenerated: "default",
};

/** Rendering thousands of rows at once makes the window scroll badly, so they come in pages. */
const PAGE_SIZE = 60;

/** Files grouped by folder, with bulk actions per folder. */
export function MergeFileList({ files, decisions, busy, onDecide, onDecideGroup, onOpen }: Props): React.JSX.Element {
  const [shown, setShown] = useState(PAGE_SIZE);
  useEffect(() => setShown(PAGE_SIZE), [files]);

  if (files.length === 0) {
    return <Typography color="text.secondary">No file matches the current filter.</Typography>;
  }
  const groups = groupByDirectory(files.slice(0, shown));
  const remaining = files.length - shown;

  return (
    <Stack spacing={1.5} className="merge-list">
      {groups.map((group) => (
        <Box key={group.directory} className="merge-group">
          <Stack direction="row" alignItems="center" spacing={1} className="merge-group-header">
            <Typography className="path-code" fontWeight={700}>{group.directory}</Typography>
            <Box sx={{ flex: 1 }} />
            <Button size="small" onClick={() => onDecideGroup(group.files, "take-old")}>Take all yours</Button>
            <Button size="small" onClick={() => onDecideGroup(group.files, "keep-new")}>Keep all new</Button>
          </Stack>
          {group.files.map((file) => {
            const decision = decisions.get(file.path);
            return (
              <Stack key={file.path} direction="row" alignItems="center" spacing={1} className="merge-row">
                {file.kind === "conflict"
                  ? <Chip size="small" label={decision ? decisionLabel(decision) : "Needs review"} color={decision ? "success" : "warning"} variant="outlined" />
                  : <Checkbox size="small" checked={decision?.action === "take-old"} onChange={(event) => onDecide(file.path, event.target.checked ? "take-old" : "keep-new")} />}
                <Typography className="path-code" sx={{ flex: 1, wordBreak: "break-all" }}>{file.path.slice(file.path.lastIndexOf("/") + 1)}</Typography>
                <Chip size="small" label={KIND_LABELS[file.kind]} color={KIND_COLORS[file.kind]} />
                <Button size="small" disabled={busy} onClick={() => onOpen(file)}>
                  {file.kind === "conflict" ? "Review" : "View changes"}
                </Button>
              </Stack>
            );
          })}
        </Box>
      ))}
      {remaining > 0 && (
        <Button onClick={() => setShown((current) => current + PAGE_SIZE)}>
          Show {Math.min(remaining, PAGE_SIZE)} more of {files.length} files
        </Button>
      )}
    </Stack>
  );
}

function decisionLabel(decision: MergeDecision): string {
  if (decision.action === "write") return "Merged";
  return decision.action === "take-old" ? "Yours" : "New";
}
