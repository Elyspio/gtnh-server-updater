import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import CreateNewFolderRounded from "@mui/icons-material/CreateNewFolderRounded";
import FolderOpenRounded from "@mui/icons-material/FolderOpenRounded";
import type { RemoteDirectoryEntry, SshConnectionInput } from "@shared/deployment.types";
import type { LatestVersions } from "@shared/releases.types";
import { api, messageOf } from "./api";

type Target = "old" | "new";

type Props = {
  connection: SshConnectionInput;
  oldServerPath: string;
  newServerPath: string;
  locked: boolean;
  onChange(paths: { oldServerPath: string; newServerPath: string }): void;
};

export function RemotePathsPanel({ connection, oldServerPath, newServerPath, locked, onChange }: Props): React.JSX.Element {
  const [browser, setBrowser] = useState<{ target: Target; path: string; entries: RemoteDirectoryEntry[] }>();
  const [newFolder, setNewFolder] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [latest, setLatest] = useState<LatestVersions>();

  // Naming hint only: a failed read leaves the panel silent instead of raising an error here.
  useEffect(() => {
    let live = true;
    void api.latestVersions().then((versions) => live && setLatest(versions)).catch(() => undefined);
    return () => { live = false; };
  }, []);

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

  const browseTo = (target: Target, remotePath: string): Promise<void> => run(async () => {
    setBrowser({ target, path: remotePath, entries: await api.listRemoteDirectory(connection, remotePath) });
  });

  const createFolder = (): Promise<void> => run(async () => {
    if (!browser || !newFolder?.trim()) return;
    const created = await api.createRemoteDirectory(connection, browser.path, newFolder.trim());
    setNewFolder(undefined);
    setBrowser({ ...browser, path: created, entries: await api.listRemoteDirectory(connection, created) });
  });

  const select = (): void => {
    if (!browser) return;
    onChange(browser.target === "old"
      ? { oldServerPath: browser.path, newServerPath }
      : { oldServerPath, newServerPath: browser.path });
    setBrowser(undefined);
  };

  const canBrowse = !locked && Boolean(connection.host.trim() && connection.username.trim() && connection.privateKeyPath.trim());

  return (
    <Paper className="section-card" elevation={0} sx={{ p: 3 }}>
      <Typography variant="h6" gutterBottom>Remote paths</Typography>
      {error && !browser && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <Stack spacing={2}>
        <TextField
          fullWidth
          label="Existing server (read only)"
          value={oldServerPath}
          disabled={locked}
          onChange={(event) => onChange({ oldServerPath: event.target.value, newServerPath })}
          onBlur={() => onChange({ oldServerPath: oldServerPath.trim(), newServerPath })}
          slotProps={{ input: { endAdornment: <Button startIcon={<FolderOpenRounded />} disabled={!canBrowse || busy} onClick={() => void browseTo("old", oldServerPath || "/")}>Browse</Button> } }}
        />
        <TextField
          fullWidth
          label="New server destination"
          value={newServerPath}
          disabled={locked}
          onChange={(event) => onChange({ oldServerPath, newServerPath: event.target.value })}
          onBlur={() => onChange({ oldServerPath, newServerPath: newServerPath.trim() })}
          helperText={describeLatest(latest)}
          slotProps={{ input: { endAdornment: <Button startIcon={<FolderOpenRounded />} disabled={!canBrowse || busy} onClick={() => void browseTo("new", newServerPath || "/")}>Browse</Button> } }}
        />
      </Stack>

      <Dialog open={Boolean(browser)} onClose={() => setBrowser(undefined)} fullWidth maxWidth="sm">
        <DialogTitle>Select remote directory</DialogTitle>
        <DialogContent>
          {browser && <>
            <Typography className="path-code" color="text.secondary" sx={{ mb: 1 }}>{browser.path}</Typography>
            {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}
            <Stack direction="row" spacing={1}>
              <Button onClick={() => void browseTo(browser.target, parentPath(browser.path))} disabled={browser.path === "/" || busy}>Parent directory</Button>
              <Button startIcon={<CreateNewFolderRounded />} disabled={busy} onClick={() => setNewFolder("")}>New folder</Button>
            </Stack>
            {newFolder !== undefined && (
              <Stack direction="row" spacing={1} sx={{ my: 1 }}>
                <TextField size="small" autoFocus fullWidth label="Folder name" value={newFolder} onChange={(event) => setNewFolder(event.target.value)} />
                <Button variant="outlined" disabled={busy || !newFolder.trim()} onClick={() => void createFolder()}>Create</Button>
                <Button onClick={() => setNewFolder(undefined)}>Cancel</Button>
              </Stack>
            )}
            <Divider />
            <List dense sx={{ minHeight: 260 }}>
              {browser.entries.filter((entry) => entry.type === "directory").map((entry) => (
                <ListItemButton key={entry.path} disabled={busy} onClick={() => void browseTo(browser.target, entry.path)}>
                  <FolderOpenRounded sx={{ mr: 1.5 }} /><ListItemText primary={entry.name} />
                </ListItemButton>
              ))}
            </List>
          </>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBrowser(undefined)}>Cancel</Button>
          <Button variant="contained" onClick={select}>Select this directory</Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}

/** Latest versions published on GitHub, so the destination folder can carry the version name. */
function describeLatest(versions: LatestVersions | undefined): string | undefined {
  if (!versions) return undefined;
  const parts = [
    versions.modpack && `GTNH ${label(versions.modpack.tag, versions.modpack.publishedAt)}`,
    versions.dailyBuild && `daily build ${label(versions.dailyBuild.tag, versions.dailyBuild.publishedAt)}`,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? `Latest on GitHub: ${parts.join(" · ")}` : undefined;
}

function label(tag: string, publishedAt: string): string {
  const published = publishedAt ? new Date(publishedAt) : undefined;
  return published && !Number.isNaN(published.getTime()) ? `${tag} (${published.toLocaleDateString()})` : tag;
}

function parentPath(value: string): string {
  if (value === "/") return "/";
  const parts = value.replace(/\/$/, "").split("/");
  parts.pop();
  return parts.join("/") || "/";
}
