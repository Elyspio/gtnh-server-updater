import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import CompareArrowsRounded from "@mui/icons-material/CompareArrowsRounded";
import MergeTypeRounded from "@mui/icons-material/MergeTypeRounded";
import type { SshConnectionInput } from "@shared/deployment.types";
import type {
  MergeApplyResult,
  MergeDecision,
  MergeDocument,
  MergeFileEntry,
  MergeFileKind,
  MergePrepareResult,
  MergeProgress,
} from "@shared/merge.types";
import type { DeploymentRecord, MergeRecord } from "@shared/journey";
import { api, messageOf } from "./api";
import { ArchiveSourceField, type ArchiveChoice } from "./ArchiveSourceField";
import { CancelOperationButton } from "./CancelOperationButton";
import { JourneyContextSummary } from "./JourneyContextSummary";
import { MergeFileList } from "./MergeFileList";

import { SkipStepButton } from "./SkipStepButton";
import { DEFAULT_EXCLUSIONS, KIND_LABELS, defaultDecisions, isUserChange } from "@shared/merge-model";

type Props = {
  connection: SshConnectionInput;
  oldServerPath: string;
  newServerPath: string;
  record?: MergeRecord;
  deployment?: DeploymentRecord;
  stopConfirmed: boolean;
  onFinished(record: MergeRecord): void;
};

/** Monaco is heavy: it is fetched when the first file is reviewed. */
const MergeReviewDialog = lazy(async () => ({ default: (await import("./MergeReviewDialog")).MergeReviewDialog }));

type Review = {
  file: MergeFileEntry;
  document?: MergeDocument;
};


export function MergePanel({ connection, oldServerPath, newServerPath, record, deployment, stopConfirmed, onFinished }: Props): React.JSX.Element {
  const [choice, setChoice] = useState<ArchiveChoice>();
  const [exclusions, setExclusions] = useState("");
  const [prepared, setPrepared] = useState<MergePrepareResult>();
  const [acknowledged, setAcknowledged] = useState(false);
  const [decisions, setDecisions] = useState<Map<string, MergeDecision>>(new Map());
  const [kindFilter, setKindFilter] = useState<MergeFileKind | "all">("all");
  const [textFilter, setTextFilter] = useState("");
  const [review, setReview] = useState<Review>();
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [progress, setProgress] = useState<MergeProgress>();
  const [result, setResult] = useState<MergeApplyResult>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => api.onMergeProgress(setProgress), []);

  const canPrepare = Boolean(record?.status !== "skipped" && connection.host.trim() && choice
    && oldServerPath.startsWith("/") && newServerPath.startsWith("/"));
  const userChanges = useMemo(() => (prepared?.files ?? []).filter(isUserChange), [prepared]);
  const regenerated = useMemo(() => (prepared?.files ?? []).filter((file) => file.kind === "regenerated"), [prepared]);
  const visibleFiles = useMemo(() => (kindFilter === "all" ? userChanges : (prepared?.files ?? []).filter((file) => file.kind === kindFilter))
    .filter((file) => file.path.toLowerCase().includes(textFilter.trim().toLowerCase())), [prepared, userChanges, kindFilter, textFilter]);
  const pendingConflicts = (prepared?.files ?? []).filter((file) => file.kind === "conflict" && !decisions.has(file.path));
  const listUnlocked = Boolean(prepared && (!prepared.baseMismatchWarning || acknowledged));

  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  };

  const prepare = (): Promise<void> => run(async () => {
    if (prepared) await api.discardMerge(prepared.operationId);
    setPrepared(undefined);
    setResult(undefined);
    if (!choice) return;
    const next = await api.prepareMerge({
      connection,
      baseSource: choice.source,
      oldServerPath,
      newServerPath,
      extraExclusions: exclusions.split(/[\n,]/),
    });
    setPrepared(next);
    setAcknowledged(false);
    setDecisions(defaultDecisions(next.files));
  });

  const setDecision = (path: string, action: "keep-new" | "take-old"): void => {
    setDecisions((current) => new Map(current).set(path, { path, action }));
  };

  const setGroupDecision = (files: MergeFileEntry[], action: "keep-new" | "take-old"): void => {
    setDecisions((current) => {
      const next = new Map(current);
      for (const file of files) next.set(file.path, { path: file.path, action });
      return next;
    });
  };

  const openReview = (file: MergeFileEntry): Promise<void> => run(async () => {
    if (!prepared) return;
    const document = await api.loadMergeFile({ operationId: prepared.operationId, path: file.path });
    setReview({ file, document });
  });


  const apply = (): Promise<void> => run(async () => {
    if (!prepared) return;
    setSummaryOpen(false);
    const started = Date.now();
    const applied = [...decisions.values()];
    const next = await api.applyMerge({
      operationId: prepared.operationId,
      baseMismatchAcknowledged: acknowledged,
      decisions: applied,
    });
    setResult(next);
    setPrepared(undefined);
    const pathsFor = (action: MergeDecision["action"]): string[] => applied.filter((decision) => decision.action === action).map((decision) => decision.path);
    onFinished({
      status: "done",
      result: next,
      copiedPaths: pathsFor("take-old"),
      mergedPaths: pathsFor("write"),
      keptPaths: pathsFor("keep-new"),
      durationMs: Date.now() - started,
    });
    if (next.status === "failed") setError(`${next.error ?? "Merge failed"}${next.failedPath ? ` (${next.failedPath})` : ""}`);
  });

  const counts = useMemo(() => {
    const values = [...decisions.values()];
    return {
      copy: values.filter((decision) => decision.action === "take-old").length,
      write: values.filter((decision) => decision.action === "write").length,
      keep: values.filter((decision) => decision.action === "keep-new").length,
    };
  }, [decisions]);

  return (
    <Paper className="section-card" elevation={0} sx={{ p: 3 }}>
      <Typography variant="h6">Carry over your changes</Typography>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        Provide the original archive of the old installation. Only files you changed since that install are proposed; everything else follows the new version.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {result?.status === "completed" && (
        <Alert severity="success" sx={{ mb: 2 }}>
          Applied: {result.copied} files copied, {result.written} merged, {result.kept} kept from the new version.
        </Alert>
      )}
      {result?.status === "failed" && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Stopped after {result.copied} copies and {result.written} merged files. The new server may be partially updated; the old server was not modified. Compare again to retry.
        </Alert>
      )}

      <JourneyContextSummary
        connection={connection}
        oldServerPath={oldServerPath}
        newServerPath={newServerPath}
        deployment={deployment}
        stopConfirmed={stopConfirmed}
      />

      <Stack spacing={2} sx={{ mt: 2 }}>
        <ArchiveSourceField
          title="Original archive of the old version"
          localLabel="Original archive of the old version"
          urlLabel="HTTPS URL of the old version"
          choice={choice}
          disabled={busy}
          onChange={setChoice}
        />
        <TextField
          fullWidth
          multiline
          minRows={2}
          label="Additional exclusions (glob, one per line)"
          helperText={`Always excluded: ${DEFAULT_EXCLUSIONS.join(", ")}, world folders and their data`}
          value={exclusions}
          onChange={(event) => setExclusions(event.target.value)}
        />
        <Stack direction="row" spacing={2} alignItems="center">
          <Button variant="outlined" startIcon={<CompareArrowsRounded />} disabled={!canPrepare || busy} onClick={() => void prepare()}>
            Compare with original archive
          </Button>
          {!busy && (!record || (record.status === "done" && record.result.status === "failed")) && <SkipStepButton label="Skip: keep the new version files" detail="No file of the old server is carried over; the new server keeps the files of the new version." onSkip={() => { if (prepared) void api.discardMerge(prepared.operationId); setPrepared(undefined); onFinished({ status: "skipped" }); }} />}
          {busy && <CircularProgress size={20} />}
          {busy && <CancelOperationButton />}
          {progress && <Typography color="text.secondary">{progress.message}</Typography>}
        </Stack>
      </Stack>

      {prepared?.baseMismatchWarning && (
        <Alert severity="warning" sx={{ mt: 2 }}>
          {prepared.baseMismatchWarning}
          <FormControlLabel
            sx={{ display: "block", mt: 1 }}
            control={<Checkbox checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />}
            label="Continue with this original archive anyway"
          />
        </Alert>
      )}

      {prepared && listUnlocked && (
        <Box sx={{ mt: 3 }}>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
            <Chip label={`${prepared.comparedBaseFiles} original files compared`} />
            <Chip label={`${userChanges.length} user changes`} color="primary" />
            {regenerated.length > 0 && <Chip label={`${regenerated.length} rewritten by mods`} />}
            <Chip label={`${pendingConflicts.length} conflicts to review`} color={pendingConflicts.length > 0 ? "warning" : "success"} />
          </Stack>
          <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
            <ToggleButtonGroup size="small" exclusive value={kindFilter} onChange={(_event, value: MergeFileKind | "all" | null) => value && setKindFilter(value)}>
              <ToggleButton value="all">All</ToggleButton>
              {(Object.keys(KIND_LABELS) as MergeFileKind[]).map((kind) => (
                <ToggleButton key={kind} value={kind}>{KIND_LABELS[kind]}</ToggleButton>
              ))}
            </ToggleButtonGroup>
            <TextField size="small" label="Filter path" value={textFilter} onChange={(event) => setTextFilter(event.target.value)} sx={{ flex: 1 }} />
          </Stack>

          <MergeFileList
            files={visibleFiles}
            decisions={decisions}
            busy={busy}
            onDecide={setDecision}
            onDecideGroup={setGroupDecision}
            onOpen={(file) => void openReview(file)}
          />

          <Stack direction="row" justifyContent="flex-end" sx={{ mt: 2 }}>
            <Button variant="contained" size="large" startIcon={<MergeTypeRounded />} disabled={busy || pendingConflicts.length > 0} onClick={() => setSummaryOpen(true)}>
              Review and apply
            </Button>
          </Stack>
        </Box>
      )}

      {review && (
        <Suspense fallback={null}>
          <MergeReviewDialog
            file={review.file}
            document={review.document}
            busy={busy}
            onClose={() => setReview(undefined)}
            onDecide={(action) => { setDecision(review.file.path, action); setReview(undefined); }}
            onWrite={(lines) => {
              setDecisions((current) => new Map(current).set(review.file.path, { path: review.file.path, action: "write", lines }));
              setReview(undefined);
            }}
          />
        </Suspense>
      )}

      <Dialog open={summaryOpen} onClose={() => setSummaryOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Apply changes to the new server</DialogTitle>
        <DialogContent>
          <Typography className="path-code" color="text.secondary" sx={{ mb: 2 }}>{prepared?.resolvedNewServerPath}</Typography>
          <Stack spacing={1}>
            <Typography>{counts.copy} files copied from the old server</Typography>
            <Typography>{counts.write} files written from a reviewed merge</Typography>
            <Typography>{counts.keep} proposed files left as in the new version</Typography>
          </Stack>
          <Alert severity="info" sx={{ mt: 2 }}>The old server is only read. Files are replaced atomically in the new server; the temporary original archive is removed afterwards.</Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSummaryOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={() => void apply()}>Apply</Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
