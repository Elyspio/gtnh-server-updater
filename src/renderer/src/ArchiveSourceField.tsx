import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  List,
  ListItemButton,
  ListItemText,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import CloudDownloadRounded from "@mui/icons-material/CloudDownloadRounded";
import type { ArchiveSource } from "@shared/deployment.types";
import type { ReleaseAsset, ReleaseSummary } from "@shared/releases.types";
import { api, messageOf } from "./api";
import { formatBytes } from "./format";

export type ArchiveChoice = { source: ArchiveSource; label: string };

type Props = {
  title: string;
  localLabel: string;
  urlLabel: string;
  choice?: ArchiveChoice;
  disabled: boolean;
  onChange(choice: ArchiveChoice | undefined): void;
};

type Mode = ArchiveSource["type"] | "release";

/** Local ZIP, HTTPS URL, or a build picked from the GTNH daily releases. */
export function ArchiveSourceField({ title, localLabel, urlLabel, choice, disabled, onChange }: Props): React.JSX.Element {
  const [mode, setMode] = useState<Mode>("release");
  const [typed, setTyped] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);

  const change = (nextMode: Mode): void => {
    setMode(nextMode);
    setTyped("");
    onChange(undefined);
  };

  const setTypedSource = (value: string): void => {
    setTyped(value);
    const trimmed = value.trim();
    if (!trimmed) {
      onChange(undefined);
      return;
    }
    onChange({
      source: mode === "local" ? { type: "local", path: trimmed } : { type: "url", url: trimmed },
      label: trimmed,
    });
  };

  return (
    <Stack spacing={1}>
      <Typography variant="h6">{title}</Typography>
      <RadioGroup row value={mode} onChange={(event) => change(event.target.value as Mode)}>
        <FormControlLabel value="release" disabled={disabled} control={<Radio />} label="GTNH daily build" />
        <FormControlLabel value="local" disabled={disabled} control={<Radio />} label="Local ZIP" />
        <FormControlLabel value="url" disabled={disabled} control={<Radio />} label="HTTPS URL" />
      </RadioGroup>

      {mode === "release" ? (
        <Stack direction="row" spacing={2} alignItems="center">
          <Button variant="outlined" startIcon={<CloudDownloadRounded />} disabled={disabled} onClick={() => setPickerOpen(true)}>
            Choose a build
          </Button>
          {choice
            ? <Chip label={choice.label} onDelete={disabled ? undefined : () => onChange(undefined)} />
            : <Typography color="text.secondary">The Linux server downloads it directly from GitHub.</Typography>}
        </Stack>
      ) : (
        <TextField
          fullWidth
          label={mode === "local" ? localLabel : urlLabel}
          value={typed}
          disabled={disabled}
          onChange={(event) => setTypedSource(event.target.value)}
          slotProps={mode === "local"
            ? { input: { endAdornment: <Button disabled={disabled} onClick={() => void api.selectArchive().then((selected) => selected && setTypedSource(selected))}>Choose</Button> } }
            : undefined}
        />
      )}

      <ReleasePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(release, asset) => {
          onChange({ source: { type: "url", url: asset.url }, label: `${release.tag} · ${asset.name} (${formatBytes(asset.size)})` });
          setPickerOpen(false);
        }}
      />
    </Stack>
  );
}

function ReleasePicker({ open, onClose, onPick }: {
  open: boolean;
  onClose(): void;
  onPick(release: ReleaseSummary, asset: ReleaseAsset): void;
}): React.JSX.Element {
  const [releases, setReleases] = useState<ReleaseSummary[]>();
  const [expanded, setExpanded] = useState<string>();
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const load = (): void => {
    setBusy(true);
    setError(undefined);
    api.listReleases()
      .then(setReleases)
      .catch((caught: unknown) => setError(messageOf(caught)))
      .finally(() => setBusy(false));
  };

  useEffect(() => {
    if (open && !releases && !busy) load();
  }, [open]);

  const visible = (releases ?? []).filter((release) => release.tag.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>GTNH daily builds</DialogTitle>
      <DialogContent>
        <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 1 }}>
          <TextField size="small" fullWidth label="Search a build" value={filter} onChange={(event) => setFilter(event.target.value)} />
          <Button disabled={busy} onClick={load}>Refresh</Button>
          {busy && <CircularProgress size={20} />}
        </Stack>
        {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}
        {!error && releases?.length === 0 && <Typography color="text.secondary">No build was returned.</Typography>}
        <List dense sx={{ minHeight: 320 }}>
          {visible.map((release) => (
            <ReleaseRow
              key={release.tag}
              release={release}
              expanded={expanded === release.tag}
              onExpand={() => setExpanded(expanded === release.tag ? undefined : release.tag)}
              onPick={onPick}
            />
          ))}
        </List>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
      </DialogActions>
    </Dialog>
  );
}

function ReleaseRow({ release, expanded, onExpand, onPick }: {
  release: ReleaseSummary;
  expanded: boolean;
  onExpand(): void;
  onPick(release: ReleaseSummary, asset: ReleaseAsset): void;
}): React.JSX.Element {
  const published = release.publishedAt ? new Date(release.publishedAt).toLocaleDateString() : "";
  return (
    <>
      <ListItemButton onClick={() => (release.recommended ? onPick(release, release.recommended) : onExpand())}>
        <ListItemText
          primary={release.tag}
          secondary={release.recommended
            ? `${published} · ${release.recommended.name} (${formatBytes(release.recommended.size)})`
            : `${published} · ${release.assets.length} archives, pick one`}
        />
      </ListItemButton>
      {!release.recommended && expanded && release.assets.map((asset) => (
        <ListItemButton key={asset.url} sx={{ pl: 4 }} onClick={() => onPick(release, asset)}>
          <ListItemText primary={asset.name} secondary={formatBytes(asset.size)} />
        </ListItemButton>
      ))}
    </>
  );
}
