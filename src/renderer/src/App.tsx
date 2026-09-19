import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  Grid,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import FolderOpenRounded from "@mui/icons-material/FolderOpenRounded";
import RocketLaunchRounded from "@mui/icons-material/RocketLaunchRounded";
import SecurityRounded from "@mui/icons-material/SecurityRounded";
import type {
  ArchiveSource,
  DeploymentPreflightResult,
  DeploymentProgress,
  DeploymentResult,
  RemoteDirectoryEntry,
  SshConnectionInput,
} from "@shared/deployment.types";

type BrowseTarget = "old" | "destination";

export function App(): React.JSX.Element {
  const [connection, setConnection] = useState<SshConnectionInput>({
    host: "",
    port: 22,
    username: "",
    privateKeyPath: "",
    passphrase: "",
  });
  const [sourceType, setSourceType] = useState<ArchiveSource["type"]>("local");
  const [sourceValue, setSourceValue] = useState("");
  const [oldServerPath, setOldServerPath] = useState("");
  const [destinationPath, setDestinationPath] = useState("");
  const [preflight, setPreflight] = useState<DeploymentPreflightResult>();
  const [confirmation, setConfirmation] = useState("");
  const [progress, setProgress] = useState<DeploymentProgress>();
  const [result, setResult] = useState<DeploymentResult>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [browser, setBrowser] = useState<{ target: BrowseTarget; path: string; entries: RemoteDirectoryEntry[] }>();

  useEffect(() => window.gtnh.onProgress(setProgress), []);

  const canPreflight = useMemo(() => Boolean(
    connection.host.trim()
    && connection.username.trim()
    && connection.privateKeyPath.trim()
    && sourceValue.trim()
    && oldServerPath.startsWith("/")
    && destinationPath.startsWith("/"),
  ), [connection, sourceValue, oldServerPath, destinationPath]);

  const updateConnection = <K extends keyof SshConnectionInput>(key: K, value: SshConnectionInput[K]): void => {
    setConnection((current) => ({ ...current, [key]: value }));
    clearPreparedState();
  };

  const clearPreparedState = (): void => {
    setPreflight(undefined);
    setConfirmation("");
    setResult(undefined);
  };

  const selectArchive = async (): Promise<void> => {
    const selected = await window.gtnh.selectArchive();
    if (selected) {
      setSourceValue(selected);
      clearPreparedState();
    }
  };

  const selectKey = async (): Promise<void> => {
    const selected = await window.gtnh.selectPrivateKey();
    if (selected) updateConnection("privateKeyPath", selected);
  };

  const openBrowser = async (target: BrowseTarget): Promise<void> => {
    const initialPath = (target === "old" ? oldServerPath : destinationPath) || "/";
    setBusy(true);
    setError(undefined);
    try {
      const entries = await window.gtnh.listRemoteDirectory(connection, initialPath);
      setBrowser({ target, path: initialPath, entries });
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  };

  const browseTo = async (remotePath: string): Promise<void> => {
    if (!browser) return;
    setBusy(true);
    try {
      const entries = await window.gtnh.listRemoteDirectory(connection, remotePath);
      setBrowser({ ...browser, path: remotePath, entries });
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  };

  const runPreflight = async (): Promise<void> => {
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    try {
      const source: ArchiveSource = sourceType === "local"
        ? { type: "local", path: sourceValue.trim() }
        : { type: "url", url: sourceValue.trim() };
      const next = await window.gtnh.preflight({ connection, source, oldServerPath, destinationPath });
      setPreflight(next);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  };

  const deploy = async (): Promise<void> => {
    if (!preflight) return;
    setBusy(true);
    setError(undefined);
    try {
      const next = await window.gtnh.execute({
        operationId: preflight.operationId,
        confirmationPath: confirmation || undefined,
      });
      setResult(next);
      if (next.status === "failed") setError(next.error ?? "Deployment failed");
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Container maxWidth="lg" sx={{ py: 5 }}>
      <Stack spacing={3}>
        <Stack direction="row" spacing={2} alignItems="center">
          <Box className="brand-mark">GT</Box>
          <Box>
            <Typography variant="h4">GTNH Server Updater</Typography>
            <Typography color="text.secondary">Prepare a clean remote deployment before migrating configuration and world data.</Typography>
          </Box>
          <Chip icon={<SecurityRounded />} label="SSH key only · no sudo" variant="outlined" sx={{ ml: "auto !important" }} />
        </Stack>

        {error && <Alert severity="error">{error}</Alert>}
        {result?.status === "completed" && <Alert severity="success">Server archive deployed to {result.destinationPath}</Alert>}
        {result?.status === "failed" && (
          <Alert severity="warning">
            Partial files were preserved at {result.destinationPath}. Temporary ZIP: {result.temporaryArchivePath}
          </Alert>
        )}

        <Paper className="section-card" elevation={0} sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>1. Linux server</Typography>
          <Grid container spacing={2}>
            <Grid size={{ xs: 6 }}><TextField fullWidth label="Host" value={connection.host} onChange={(event) => updateConnection("host", event.target.value)} /></Grid>
            <Grid size={{ xs: 2 }}><TextField fullWidth label="Port" type="number" value={connection.port} onChange={(event) => updateConnection("port", Number(event.target.value))} /></Grid>
            <Grid size={{ xs: 4 }}><TextField fullWidth label="Username" value={connection.username} onChange={(event) => updateConnection("username", event.target.value)} /></Grid>
            <Grid size={{ xs: 8 }}>
              <TextField fullWidth label="Private key" value={connection.privateKeyPath} onChange={(event) => updateConnection("privateKeyPath", event.target.value)} slotProps={{ input: { endAdornment: <Button onClick={() => void selectKey()}>Choose</Button> } }} />
            </Grid>
            <Grid size={{ xs: 4 }}><TextField fullWidth label="Key passphrase" type="password" value={connection.passphrase} onChange={(event) => updateConnection("passphrase", event.target.value)} /></Grid>
          </Grid>
        </Paper>

        <Paper className="section-card" elevation={0} sx={{ p: 3 }}>
          <Typography variant="h6">2. Server archive</Typography>
          <RadioGroup row value={sourceType} onChange={(event) => { setSourceType(event.target.value as ArchiveSource["type"]); setSourceValue(""); clearPreparedState(); }}>
            <FormControlLabel value="local" control={<Radio />} label="Local ZIP (SFTP upload)" />
            <FormControlLabel value="url" control={<Radio />} label="Public HTTPS URL" />
          </RadioGroup>
          <TextField
            fullWidth
            label={sourceType === "local" ? "Local ZIP path" : "HTTPS URL"}
            value={sourceValue}
            onChange={(event) => { setSourceValue(event.target.value); clearPreparedState(); }}
            slotProps={sourceType === "local" ? { input: { endAdornment: <Button onClick={() => void selectArchive()}>Choose</Button> } } : undefined}
          />
        </Paper>

        <Paper className="section-card" elevation={0} sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>3. Remote paths</Typography>
          <Stack spacing={2}>
            <TextField fullWidth label="Existing server" value={oldServerPath} onChange={(event) => { setOldServerPath(event.target.value); clearPreparedState(); }} slotProps={{ input: { endAdornment: <Button startIcon={<FolderOpenRounded />} onClick={() => void openBrowser("old")}>Browse</Button> } }} />
            <TextField fullWidth label="New server destination" value={destinationPath} onChange={(event) => { setDestinationPath(event.target.value); clearPreparedState(); }} slotProps={{ input: { endAdornment: <Button startIcon={<FolderOpenRounded />} onClick={() => void openBrowser("destination")}>Browse</Button> } }} />
          </Stack>
        </Paper>

        {progress && (
          <Paper className="section-card" elevation={0} sx={{ p: 2 }}>
            <Stack direction="row" spacing={2} alignItems="center">
              {busy && <CircularProgress size={20} />}
              <Box><Typography fontWeight={700}>{progress.stage}</Typography><Typography color="text.secondary">{progress.message}</Typography></Box>
              {progress.totalBytes && <Typography sx={{ ml: "auto !important" }}>{formatBytes(progress.transferredBytes ?? 0)} / {formatBytes(progress.totalBytes)}</Typography>}
            </Stack>
          </Paper>
        )}

        {preflight && (
          <Paper className="section-card" elevation={0} sx={{ p: 3 }}>
            <Typography variant="h6">Preflight passed</Typography>
            <Stack direction="row" spacing={1} sx={{ my: 2 }} flexWrap="wrap">
              <Chip label={`${formatBytes(preflight.compressedBytes)} ZIP`} />
              <Chip label={`${formatBytes(preflight.uncompressedBytes)} extracted`} />
              <Chip label={`${formatBytes(preflight.availableFreeBytes)} available`} color="success" />
            </Stack>
            <Typography className="path-code" color="text.secondary">Resolved destination: {preflight.resolvedDestinationPath}</Typography>
            {preflight.destinationNonEmpty && (
              <Box sx={{ mt: 2 }}>
                <Alert severity="warning" sx={{ mb: 2 }}>The existing destination is not empty and will be permanently deleted.</Alert>
                <Typography variant="body2" sx={{ mb: 1 }}>Preview: {preflight.destinationPreview.slice(0, 8).map((entry) => entry.name).join(", ")}</Typography>
                <TextField fullWidth label="Type the exact resolved destination path" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
              </Box>
            )}
          </Paper>
        )}

        <Stack direction="row" justifyContent="flex-end" spacing={2}>
          <Button variant="outlined" size="large" disabled={!canPreflight || busy} onClick={() => void runPreflight()}>Run preflight</Button>
          <Button variant="contained" size="large" startIcon={<RocketLaunchRounded />} disabled={!preflight || busy || (preflight.destinationNonEmpty && confirmation !== preflight.resolvedDestinationPath)} onClick={() => void deploy()}>Deploy archive</Button>
        </Stack>
      </Stack>

      <Dialog open={Boolean(browser)} onClose={() => setBrowser(undefined)} fullWidth maxWidth="sm">
        <DialogTitle>Select remote directory</DialogTitle>
        <DialogContent>
          {browser && <>
            <Typography className="path-code" color="text.secondary" sx={{ mb: 1 }}>{browser.path}</Typography>
            <Button onClick={() => void browseTo(parentPath(browser.path))} disabled={browser.path === "/"}>Parent directory</Button>
            <Divider />
            <List dense sx={{ minHeight: 260 }}>
              {browser.entries.filter((entry) => entry.type === "directory").map((entry) => (
                <ListItemButton key={entry.path} onDoubleClick={() => void browseTo(entry.path)}>
                  <FolderOpenRounded sx={{ mr: 1.5 }} /><ListItemText primary={entry.name} secondary="Double-click to open" />
                </ListItemButton>
              ))}
            </List>
          </>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBrowser(undefined)}>Cancel</Button>
          <Button variant="contained" onClick={() => {
            if (!browser) return;
            if (browser.target === "old") setOldServerPath(browser.path); else setDestinationPath(browser.path);
            clearPreparedState();
            setBrowser(undefined);
          }}>Select this directory</Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let amount = value;
  let unit = -1;
  do { amount /= 1024; unit += 1; } while (amount >= 1024 && unit < units.length - 1);
  return `${amount.toFixed(amount >= 10 ? 1 : 2)} ${units[unit]}`;
}

function parentPath(value: string): string {
  if (value === "/") return "/";
  const parts = value.replace(/\/$/, "").split("/");
  parts.pop();
  return parts.join("/") || "/";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
