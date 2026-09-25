import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  ButtonBase,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Grid,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import AddRounded from "@mui/icons-material/AddRounded";
import CheckCircleRounded from "@mui/icons-material/CheckCircleRounded";
import DeleteOutlineRounded from "@mui/icons-material/DeleteOutlineRounded";
import EditRounded from "@mui/icons-material/EditRounded";
import LanRounded from "@mui/icons-material/LanRounded";
import SaveRounded from "@mui/icons-material/SaveRounded";
import type { ConnectionTestResult, HostKeyCheck, SshProfile } from "@shared/connection.types";
import type { SshConnectionInput } from "@shared/deployment.types";
import { api, messageOf } from "./api";

type Props = {
  connection: SshConnectionInput;
  oldServerPath: string;
  newServerPath: string;
  onConnectionChange(connection: SshConnectionInput): void;
  onProfileLoaded(profile: SshProfile): void;
  /** Called after each test with whether the server is trusted and the key accepted. */
  onTested(ready: boolean): void;
  locked: boolean;
};

type UntrustedHost = Exclude<HostKeyCheck, { status: "known" }>;

type SaveDraft = { name: string; rememberPassphrase: boolean };

const BLANK: SshConnectionInput = { host: "", port: 22, username: "", privateKeyPath: "", passphrase: "" };

/** Saved profiles first: picking one loads it and tests the server at once. */
export function ConnectionPanel({ connection, oldServerPath, newServerPath, onConnectionChange, onProfileLoaded, onTested, locked }: Props): React.JSX.Element {
  const [profiles, setProfiles] = useState<SshProfile[]>([]);
  const [canStorePassphrase, setCanStorePassphrase] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saveDraft, setSaveDraft] = useState<SaveDraft>();
  const [deleting, setDeleting] = useState<SshProfile>();
  const [test, setTest] = useState<ConnectionTestResult>();
  const [untrusted, setUntrusted] = useState<UntrustedHost>();
  const [message, setMessage] = useState<{ severity: "success" | "error" | "info"; text: string }>();
  const [busy, setBusy] = useState(false);

  const selected = profiles.find((profile) => profile.id === connection.profileId);
  const complete = Boolean(connection.host.trim() && connection.username.trim() && connection.privateKeyPath.trim());

  const refresh = async (): Promise<SshProfile[]> => {
    const list = await api.listProfiles();
    setProfiles(list.profiles);
    setCanStorePassphrase(list.canStorePassphrase);
    return list.profiles;
  };

  useEffect(() => {
    refresh()
      // Nothing to pick from: the form is the whole first experience.
      .then((list) => setEditing(list.length === 0))
      .catch((caught: unknown) => {
        setEditing(true);
        setMessage({ severity: "error", text: `Saved profiles could not be loaded: ${messageOf(caught)}` });
      });
  }, []);

  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setMessage(undefined);
    try {
      await action();
    } catch (caught) {
      setMessage({ severity: "error", text: messageOf(caught) });
    } finally {
      setBusy(false);
    }
  };

  const update = <K extends keyof SshConnectionInput>(key: K, value: SshConnectionInput[K]): void => {
    onConnectionChange({ ...connection, [key]: value });
    setTest(undefined);
  };

  /** Takes the connection to test explicitly: a profile is tested before React re-renders with it. */
  const testConnection = (input: SshConnectionInput): Promise<void> => run(async () => {
    const result = await api.testConnection(input);
    setTest(result);
    onTested(result.authenticated);
    if (result.hostKey.status !== "known") setUntrusted(result.hostKey);
    else setMessage({ severity: "success", text: "Connected: server identity verified and key accepted." });
  });

  const chooseProfile = (profile: SshProfile): void => {
    const next: SshConnectionInput = {
      host: profile.host,
      port: profile.port,
      username: profile.username,
      privateKeyPath: profile.privateKeyPath,
      passphrase: "",
      profileId: profile.id,
    };
    setTest(undefined);
    setEditing(false);
    onConnectionChange(next);
    onProfileLoaded(profile);
    void testConnection(next);
  };

  const newConnection = (): void => {
    setTest(undefined);
    setEditing(true);
    setMessage(undefined);
    onConnectionChange({ ...BLANK });
  };

  const saveProfile = (draft: SaveDraft): Promise<void> => run(async () => {
    const saved = await api.saveProfile({
      id: connection.profileId,
      name: draft.name,
      host: connection.host,
      port: connection.port,
      username: connection.username,
      privateKeyPath: connection.privateKeyPath,
      oldServerPath,
      newServerPath,
      passphrase: connection.passphrase || undefined,
      rememberPassphrase: draft.rememberPassphrase,
    });
    await refresh();
    setSaveDraft(undefined);
    setEditing(false);
    onConnectionChange({ ...connection, profileId: saved.id });
    setMessage({ severity: "success", text: `Profile "${saved.name}" saved${saved.hasStoredPassphrase ? " with an encrypted passphrase" : ""}.` });
  });

  const deleteProfile = (profile: SshProfile): Promise<void> => run(async () => {
    await api.deleteProfile(profile.id);
    setDeleting(undefined);
    const remaining = await refresh();
    if (connection.profileId === profile.id) {
      setTest(undefined);
      onConnectionChange({ ...BLANK });
      setEditing(remaining.length === 0);
    }
  });

  const trust = (host: UntrustedHost): Promise<void> => run(async () => {
    await api.trustHost({ host: host.host, port: host.port, fingerprint: host.fingerprint });
    setUntrusted(undefined);
    const result = await api.testConnection(connection);
    setTest(result);
    onTested(result.authenticated);
    setMessage({ severity: "success", text: "Server identity trusted and connection verified." });
  });

  const killOrphan = (id: string, pid: number): Promise<void> => run(async () => {
    await api.killOrphan(connection, id, pid);
    setTest(await api.testConnection(connection));
  });

  return (
    <Paper className="section-card" elevation={0} sx={{ p: 3 }}>
      <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h6">SSH connection</Typography>
        <StatusChip busy={busy} test={test} />
      </Stack>

      {profiles.length > 0 && (
      <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: "wrap" }}>
        {profiles.map((profile) => (
          <ButtonBase
            key={profile.id}
            className={`profile-card${profile.id === connection.profileId ? " profile-card-selected" : ""}`}
            disabled={locked || busy}
            onClick={() => chooseProfile(profile)}
          >
            <Stack spacing={0.25} sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="subtitle2" noWrap>{profile.name}</Typography>
              <Typography className="path-code" variant="caption" color="text.secondary" noWrap>
                {profile.username}@{profile.host}:{profile.port}
              </Typography>
            </Stack>
            {profile.id === connection.profileId && <CheckCircleRounded color="primary" fontSize="small" />}
          </ButtonBase>
        ))}
        <ButtonBase className="profile-card profile-card-new" disabled={locked || busy} onClick={newConnection}>
          <AddRounded fontSize="small" />
          <Typography variant="subtitle2">New connection</Typography>
        </ButtonBase>
      </Stack>
      )}

      {editing ? (
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          <Grid size={{ xs: 6 }}><TextField fullWidth label="Host" value={connection.host} disabled={locked} onChange={(event) => update("host", event.target.value)} onBlur={() => update("host", connection.host.trim())} /></Grid>
          <Grid size={{ xs: 2 }}><TextField fullWidth label="Port" type="number" value={connection.port} disabled={locked} onChange={(event) => update("port", Number(event.target.value))} /></Grid>
          <Grid size={{ xs: 4 }}><TextField fullWidth label="Username" value={connection.username} disabled={locked} onChange={(event) => update("username", event.target.value)} onBlur={() => update("username", connection.username.trim())} /></Grid>
          <Grid size={{ xs: 8 }}>
            <TextField
              fullWidth
              label="Private key"
              value={connection.privateKeyPath}
              disabled={locked} onChange={(event) => update("privateKeyPath", event.target.value)}
              onBlur={() => update("privateKeyPath", connection.privateKeyPath.trim())}
              slotProps={{ input: { endAdornment: <Button onClick={() => void api.selectPrivateKey().then((path) => path && update("privateKeyPath", path))}>Choose</Button> } }}
            />
          </Grid>
          <Grid size={{ xs: 4 }}>
            <TextField
              fullWidth
              label="Key passphrase"
              type="password"
              value={connection.passphrase ?? ""}
              placeholder={selected?.hasStoredPassphrase ? "Stored securely" : undefined}
              onChange={(event) => update("passphrase", event.target.value)}
            />
          </Grid>
        </Grid>
      ) : complete ? (
        <Stack direction="row" spacing={2} alignItems="center" className="connection-summary" sx={{ mt: 2, p: 1.5 }}>
          <Stack spacing={0.25} sx={{ flex: 1, minWidth: 0 }}>
            <Typography className="path-code">{connection.username}@{connection.host}:{connection.port}</Typography>
            <Typography className="path-code" variant="caption" color="text.secondary" sx={{ wordBreak: "break-all" }}>
              {connection.privateKeyPath}{selected?.hasStoredPassphrase ? " · passphrase stored" : ""}
            </Typography>
          </Stack>
          <Button startIcon={<EditRounded />} disabled={locked} onClick={() => setEditing(true)}>Edit</Button>
        </Stack>
      ) : (
        <Typography color="text.secondary" sx={{ mt: 2 }}>Pick a saved profile, or create a new connection.</Typography>
      )}

      <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 2 }}>
        {busy && <CircularProgress size={18} />}
        <Button
          variant="outlined"
          startIcon={<LanRounded />}
          disabled={busy || !complete}
          onClick={() => void testConnection(connection)}
          sx={{ ml: "auto !important" }}
        >
          Test connection
        </Button>
        <Button
          startIcon={<SaveRounded />}
          disabled={busy || locked || !complete}
          onClick={() => setSaveDraft({ name: selected?.name ?? "", rememberPassphrase: selected?.hasStoredPassphrase ?? false })}
        >
          {selected ? "Update profile" : "Save as profile"}
        </Button>
        {selected && (
          <Button color="error" startIcon={<DeleteOutlineRounded />} disabled={busy || locked} onClick={() => setDeleting(selected)}>Delete</Button>
        )}
      </Stack>

      {message && <Alert severity={message.severity} sx={{ mt: 2 }}>{message.text}</Alert>}
      {test?.hostKey.status === "mismatch" && (
        <Alert severity="error" sx={{ mt: 2 }}>
          The server identity changed ({test.hostKey.keyType} {test.hostKey.fingerprint}). The app refuses to connect. If the change is expected, remove the old key from known_hosts yourself.
        </Alert>
      )}
      {test && test.orphans.length > 0 && (
        <Alert severity="warning" sx={{ mt: 2 }}>
          Processes started by a previous run are still alive on the server:
          {test.orphans.map((orphan) => (
            <Stack key={orphan.id} direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
              <Typography className="path-code" variant="body2" sx={{ flex: 1, wordBreak: "break-all" }}>PID {orphan.pid}: {orphan.command}</Typography>
              <Button size="small" color="warning" disabled={busy} onClick={() => void killOrphan(orphan.id, orphan.pid)}>Stop</Button>
            </Stack>
          ))}
        </Alert>
      )}

      <Dialog open={Boolean(saveDraft)} onClose={() => setSaveDraft(undefined)} maxWidth="xs" fullWidth>
        <DialogTitle>{selected ? "Update this profile" : "Save this connection"}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Profile name"
            value={saveDraft?.name ?? ""}
            sx={{ mt: 1 }}
            onChange={(event) => setSaveDraft((draft) => draft && { ...draft, name: event.target.value })}
          />
          <FormControlLabel
            disabled={!canStorePassphrase}
            sx={{ mt: 1 }}
            control={
              <Checkbox
                checked={Boolean(saveDraft?.rememberPassphrase) && canStorePassphrase}
                onChange={(event) => setSaveDraft((draft) => draft && { ...draft, rememberPassphrase: event.target.checked })}
              />
            }
            label={canStorePassphrase ? "Remember passphrase (OS encrypted)" : "Passphrase storage unavailable: no OS keyring"}
          />
          <Typography variant="body2" color="text.secondary">The remote paths chosen below are saved with the profile.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSaveDraft(undefined)}>Cancel</Button>
          <Button variant="contained" disabled={busy || !saveDraft?.name.trim()} onClick={() => saveDraft && void saveProfile(saveDraft)}>Save</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(deleting)} onClose={() => setDeleting(undefined)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete this profile?</DialogTitle>
        <DialogContent>
          <Typography>"{deleting?.name}" ({deleting?.username}@{deleting?.host}) is removed from this computer, with its stored passphrase. The server is not touched.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleting(undefined)}>Cancel</Button>
          <Button color="error" variant="contained" disabled={busy} onClick={() => deleting && void deleteProfile(deleting)}>Delete</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={untrusted?.status === "unknown"} onClose={() => setUntrusted(undefined)} maxWidth="sm" fullWidth>
        <DialogTitle>Trust this server?</DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 2 }}>{untrusted?.host}:{untrusted?.port} is not in known_hosts. Compare this fingerprint with the server before trusting it:</Typography>
          <Typography className="path-code" sx={{ wordBreak: "break-all" }}>{untrusted?.keyType} {untrusted?.fingerprint}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>On the server: ssh-keygen -lf /etc/ssh/ssh_host_{untrusted?.keyType.replace(/^ssh-/, "").replace(/^ecdsa-sha2-nistp\d+$/, "ecdsa")}_key.pub</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setUntrusted(undefined)}>Cancel</Button>
          <Button variant="contained" disabled={busy} onClick={() => untrusted && void trust(untrusted)}>Trust and connect</Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}

function StatusChip({ busy, test }: { busy: boolean; test?: ConnectionTestResult }): React.JSX.Element {
  if (busy) return <Chip size="small" variant="outlined" icon={<CircularProgress size={12} />} label="Testing" />;
  if (test?.authenticated) return <Chip size="small" color="success" variant="outlined" label="Connected" />;
  if (test) return <Chip size="small" color="error" variant="outlined" label="Not connected" />;
  return <Chip size="small" variant="outlined" label="Not tested" />;
}
