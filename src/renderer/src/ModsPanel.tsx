import { cloneElement, useCallback, useEffect, useState } from "react";
import {
	Alert,
	Button,
	Checkbox,
	Chip,
	CircularProgress,
	Dialog,
	DialogActions,
	DialogContent,
	DialogTitle,
	FormControlLabel,
	LinearProgress,
	Radio,
	Stack,
	TextField,
	Typography,
} from "@mui/material";
import FolderOpenRounded from "@mui/icons-material/FolderOpenRounded";
import RefreshRounded from "@mui/icons-material/RefreshRounded";
import type { SshConnectionInput } from "@shared/deployment.types";
import { latestPerRelease, releaseName } from "@shared/mod-builds";
import type { ModJar, ModsApplyRequest, ModsApplyResult, ModsInspectResult, ModsSettings, ModTargetState } from "@shared/mods.types";
import { formatDuration } from "@shared/journey";
import { api, messageOf } from "./api";
import { CancelOperationButton } from "./CancelOperationButton";
import { formatBytes } from "./format";
import { type ModsRun, formatClock } from "./mods-run";

type Action = ModsApplyRequest["action"];

type Props = {
	connection: SshConnectionInput;
	serverReady: boolean;
	serviceName: string;
	onServiceNameChange(serviceName: string): void;
	/** The install or restore in progress, or the last one. */
	run?: ModsRun;
	onRunStart(action: Action): void;
	/** The shared SSH connection panel, rendered at the top of the page. */
	connectionPanel: React.ReactNode;
};

/** Replace one mod by a local build on the profile's server, then on chosen Prism instances. */
export function ModsPanel({ connection, serverReady, serviceName, onServiceNameChange, run, onRunStart, connectionPanel }: Props): React.JSX.Element {
	const [settings, setSettings] = useState<ModsSettings>();
	const [modId, setModId] = useState<string>();
	const [jars, setJars] = useState<ModJar[]>([]);
	const [jar, setJar] = useState<ModJar>();
	const [includeServer, setIncludeServer] = useState(true);
	const [inspection, setInspection] = useState<ModsInspectResult>();
	const [instanceIds, setInstanceIds] = useState<string[]>([]);
	const [confirming, setConfirming] = useState<Action>();
	const [result, setResult] = useState<ModsApplyResult>();
	const [busy, setBusy] = useState<"reading" | "inspecting" | "applying">();
	const [error, setError] = useState<string>();
	const [allBuilds, setAllBuilds] = useState(false);
	const [connectionOpen, setConnectionOpen] = useState(false);

	useEffect(() => {
		api.modsSettings()
			.then(setSettings)
			.catch((caught: unknown) => setError(messageOf(caught)));
	}, []);
	// Open on the first remembered mod, so its newest builds are listed without a click.
	const firstSource = settings?.sources[0]?.modId;
	useEffect(() => {
		if (firstSource && !modId) void chooseModId(firstSource);
		// Only once settings arrive: later changes are the user's choice.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [firstSource]);

	const serverTargeted = includeServer && serverReady && Boolean(serviceName.trim());

	const perform = async (kind: NonNullable<typeof busy>, action: () => Promise<void>): Promise<void> => {
		setBusy(kind);
		setError(undefined);
		try {
			await action();
		} catch (caught) {
			setError(messageOf(caught));
		} finally {
			setBusy(undefined);
		}
	};

	const inspect = useCallback(
		async (id: string, prismDirectory: string): Promise<void> => {
			const next = await api.inspectMods({ modId: id, prismDirectory, server: serverTargeted ? { connection, serviceName: serviceName.trim() } : undefined });
			setInspection(next);
			// Only instances where the mod can be replaced or restored stay ticked.
			setInstanceIds((current) => current.filter((instanceId) => next.instances.some((instance) => instance.id === instanceId && instance.state.status === "ready")));
		},
		[connection, serverTargeted, serviceName]
	);

	/** Lists the builds of a mod and proposes the newest build of its newest version. */
	const openMod = async (id: string, prismDirectory: string | undefined): Promise<void> => {
		setModId(id);
		setResult(undefined);
		setInspection(undefined);
		setAllBuilds(false);
		const listed = await api.listModSource(id);
		setJars(listed);
		setJar(latestPerRelease(listed)[0]?.jar);
		if (prismDirectory) await inspect(id, prismDirectory);
	};

	const chooseModId = (id: string): Promise<void> => perform("reading", async () => await openMod(id, settings?.prismDirectory));

	const chooseFolder = (): Promise<void> =>
		perform("reading", async () => {
			const folder = await api.selectModFolder(modId);
			if (!folder) return;
			const read = await api.readModFolder(folder);
			setSettings(read.settings);
			const first = read.modIds[0];
			if (first) await openMod(first, read.settings.prismDirectory);
		});

	const forget = (id: string): Promise<void> =>
		perform("reading", async () => {
			setSettings(await api.forgetModSource(id));
			if (modId === id) {
				setJars([]);
				setJar(undefined);
			}
		});

	const changePrismDirectory = (directory: string | null): Promise<void> =>
		perform("reading", async () => {
			setSettings(await api.setPrismDirectory(directory));
			setInspection(undefined);
		});

	const checkTargets = (): Promise<void> =>
		perform("inspecting", async () => {
			if (modId && settings) await inspect(modId, settings.prismDirectory);
		});

	const apply = (action: Action): Promise<void> =>
		perform("applying", async () => {
			if (!modId || !settings) return;
			setConfirming(undefined);
			setResult(undefined);
			onRunStart(action);
			const outcome = await api.applyMods({
				action,
				modId,
				jarPath: action === "replace" ? jar?.path : undefined,
				server: serverTargeted && serverCanAct(inspection, action) ? { connection, serviceName: serviceName.trim(), restartConfirmed: true } : undefined,
				prismDirectory: settings.prismDirectory,
				instanceIds: instanceIds.filter((id) => instanceCanAct(inspection, id, action)),
			});
			setResult(outcome);
			await inspect(modId, settings.prismDirectory);
		});

	const serverState = inspection?.server && "state" in inspection.server ? inspection.server.state : undefined;
	const targetsFor = (action: Action): string[] => {
		const targets: string[] = [];
		if (serverTargeted && serverCanAct(inspection, action)) targets.push(`Server: ${serviceName} on ${connection.host} (${serverState?.serverPath ?? "?"})`);
		for (const id of instanceIds) {
			if (instanceCanAct(inspection, id, action)) targets.push(`Prism: ${inspection?.instances.find((instance) => instance.id === id)?.name ?? id}`);
		}
		return targets;
	};
	const canReplace = Boolean(jar && jar.modId === modId) && targetsFor("replace").length > 0;
	const canRestore = targetsFor("restore").length > 0;
	const source = settings?.sources.find((candidate) => candidate.modId === modId);
	const installedVersion = [serverState?.state, ...(inspection?.instances.map((instance) => instance.state) ?? [])].find((state) => state?.status === "ready");
	const releases = latestPerRelease(jars);
	// The chosen build stays listed even when it is not the newest of its release.
	const shown = allBuilds
		? jars.map((build) => ({ jar: build, release: undefined, otherBuilds: 0 }))
		: jar && !releases.some((release) => release.jar.path === jar.path)
			? [...releases, { jar, release: undefined, otherBuilds: 0 }]
			: releases;
	const fromVersion = installedVersion?.status === "ready" ? (releaseName(installedVersion.current.version) ?? installedVersion.current.fileName) : undefined;

	return (
		<Stack spacing={2}>
			{serverReady && !connectionOpen && (
				<div className="connection-strip">
					<span className="state-tag is-done">connected</span>
					<Typography className="path-code" sx={{ fontWeight: 650 }}>
						{connection.username}@{connection.host}:{connection.port}
					</Typography>
					<Button size="small" onClick={() => setConnectionOpen(true)}>
						Change server
					</Button>
				</div>
			)}
			<div hidden={serverReady && !connectionOpen}>{connectionPanel}</div>
			{serverReady && connectionOpen && (
				<Button size="small" sx={{ alignSelf: "flex-start" }} onClick={() => setConnectionOpen(false)}>
					Hide connection
				</Button>
			)}

			<section className="section-card mods-drawing" aria-label="Build and targets">
				<div className="drawing-part">
					<div className="drawing-part-head">
						<Typography variant="subtitle1">Your build</Typography>
						{busy === "reading" && <CircularProgress size={16} />}
						<Button size="small" variant="outlined" startIcon={<FolderOpenRounded />} disabled={Boolean(busy)} onClick={() => void chooseFolder()}>
							Choose folder
						</Button>
					</div>
					{settings && settings.sources.length > 0 && (
						<Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", mb: 1.5 }}>
							{settings.sources.map((candidate) => (
								<Chip
									key={candidate.modId}
									label={candidate.name ?? candidate.modId}
									color={candidate.modId === modId ? "primary" : "default"}
									variant={candidate.modId === modId ? "filled" : "outlined"}
									disabled={Boolean(busy)}
									onClick={() => void chooseModId(candidate.modId)}
									onDelete={() => void forget(candidate.modId)}
									title={`${candidate.modId}, from ${candidate.folder}`}
								/>
							))}
						</Stack>
					)}
					{source && (
						<Typography variant="body2" className="path-code" sx={{ color: "text.secondary", mb: 0.5 }}>
							From {source.folder}
						</Typography>
					)}
					{!modId && (
						<Typography variant="body2" sx={{ color: "text.secondary" }}>
							{settings && settings.sources.length > 0
								? "Pick a mod above, or choose another build folder."
								: "Choose the folder your builds land in, such as build/libs. Each version found there is proposed, and the folder is remembered."}
						</Typography>
					)}
					{modId && jars.length === 0 && !busy && (
						<Typography variant="body2" sx={{ color: "warning.main" }}>
							No JAR declaring {modId} in this folder.
						</Typography>
					)}
					<div className="option-list">
						{shown.map(({ jar: candidate, release, otherBuilds }) => (
							<OptionRow
								key={candidate.path}
								control={<Radio size="small" checked={candidate.path === jar?.path} onChange={() => setJar(candidate)} disabled={Boolean(busy)} />}
								title={release ?? candidate.fileName}
								detail={`${release ? `${candidate.fileName}, ` : ""}${new Date(candidate.modifiedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}, ${formatBytes(candidate.sizeBytes)}${otherBuilds > 0 ? `, ${otherBuilds} older build${otherBuilds > 1 ? "s" : ""} hidden` : ""}`}
							/>
						))}
					</div>
					{jars.length > releases.length && (
						<Button size="small" sx={{ mt: 0.5, ml: -0.75 }} onClick={() => setAllBuilds((current) => !current)}>
							{allBuilds ? "Newest build per version only" : `Show all ${jars.length} builds`}
						</Button>
					)}
				</div>

				<div className="wire" aria-hidden="true" />

				<div className="drawing-part">
					<div className="drawing-part-head">
						<Typography variant="subtitle1">Replaces</Typography>
						{busy === "inspecting" && <CircularProgress size={16} />}
						<Button size="small" startIcon={<RefreshRounded />} disabled={!modId || !settings || Boolean(busy)} onClick={() => void checkTargets()}>
							Check targets
						</Button>
					</div>
					<div className="option-list">
						<OptionRow
							control={
								<Checkbox
									size="small"
									checked={includeServer && serverReady}
									disabled={!serverReady || Boolean(busy)}
									onChange={(event) => setIncludeServer(event.target.checked)}
								/>
							}
							title={`Server ${serviceName || "(no service)"}`}
							tag={
								!serverReady ? (
									<Tag tone="muted">test SSH first</Tag>
								) : inspection?.server && "error" in inspection.server ? (
									<Tag tone="fault">error</Tag>
								) : serverTargeted && serverState?.state.status === "ready" ? (
									<Tag tone="live">restarts</Tag>
								) : (
									serverState && stateTag(serverState.state, jar)
								)
							}
							detail={
								inspection?.server && "error" in inspection.server
									? inspection.server.error
									: serverState
										? `${serverState.serverPath}, ${describeState(serverState.state)}`
										: serverReady
											? "Choose a mod to check the server."
											: "Test the SSH connection above to include the server."
							}
							detailTone={inspection?.server && "error" in inspection.server ? "error.main" : undefined}
						/>
						{inspection?.instances.map((instance) => (
							<OptionRow
								key={instance.id}
								control={
									<Checkbox
										size="small"
										checked={instanceIds.includes(instance.id)}
										disabled={instance.state.status !== "ready" || Boolean(busy)}
										onChange={(event) =>
											setInstanceIds((current) => (event.target.checked ? [...current, instance.id] : current.filter((id) => id !== instance.id)))
										}
									/>
								}
								title={instance.name}
								tag={stateTag(instance.state, jar)}
								detail={`Prism, ${describeState(instance.state)}`}
								dimmed={instance.state.status !== "ready"}
							/>
						))}
					</div>
					{inspection?.instancesError && (
						<Alert severity="error" sx={{ mt: 1 }}>
							{inspection.instancesError}
						</Alert>
					)}
					{!inspection && modId && !busy && (
						<Typography variant="body2" sx={{ color: "text.secondary", mt: 1 }}>
							Check the targets to list the Prism instances.
						</Typography>
					)}
				</div>
				<div className="drawing-settings">
					<TextField
						size="small"
						label="systemd service"
						value={serviceName}
						disabled={Boolean(busy)}
						onChange={(event) => onServiceNameChange(event.target.value)}
						title="Its WorkingDirectory is the server folder. Saved with the profile."
						sx={{ width: 170 }}
					/>
					<Typography variant="body2" sx={{ color: "text.secondary", ml: 1 }}>
						Prism instances in
					</Typography>
					<Typography variant="body2" className="path-code" sx={{ minWidth: 0 }}>
						{settings?.prismDirectory}
					</Typography>
					<Button
						size="small"
						disabled={Boolean(busy)}
						onClick={() =>
							void api.selectDirectory().then(async (directory) => {
								if (directory) await changePrismDirectory(directory);
							})
						}
					>
						Change
					</Button>
					{settings && !settings.prismDirectoryIsDefault && (
						<Button size="small" disabled={Boolean(busy)} onClick={() => void changePrismDirectory(null)}>
							Use default
						</Button>
					)}
				</div>
			</section>

			{error && <Alert severity="error">{error}</Alert>}

			<div className="mods-lower">
				<div>
					{busy === "applying" && <LinearProgress sx={{ mb: 2 }} />}
					{run && run.entries.length > 0 ? (
						<ol className="run-log" aria-live="polite">
							{run.entries.map((entry, index) => (
								<li
									key={`${entry.at}-${index}`}
									className={
										entry.stage === "failed"
											? "is-fault"
											: entry.stage === "completed"
												? "is-done"
												: busy === "applying" && index === run.entries.length - 1
													? "is-live"
													: undefined
									}
								>
									<time>{formatClock(entry.at)}</time>
									{entry.message}
								</li>
							))}
						</ol>
					) : (
						<Typography variant="body2" sx={{ color: "text.secondary", borderLeft: 2, borderColor: "divider", pl: 2 }}>
							{busy === "applying"
								? "Starting"
								: "Nothing installed yet. The server is stopped, swapped and started, then its FML log is watched until it has started. Prism instances are changed after that. Originals are kept in mods-backup/."}
						</Typography>
					)}
					{result && <ResultView result={result} />}
				</div>

				<div className="title-block">
					<div className="title-block-name">
						{modId ? `${source?.name ?? modId} ${fromVersion ?? ""}${jar?.version ? ` to ${releaseName(jar.version)}` : ""}` : "No mod chosen"}
					</div>
					<div>
						<span>Server</span>
						{serverTargeted ? `${connection.username}@${connection.host}` : "not included"}
					</div>
					<div>
						<span>Service</span>
						{serviceName || "none"}
					</div>
					<div>
						<span>Prism instances</span>
						{instanceIds.length === 0 ? "none ticked" : `${instanceIds.length} ticked`}
					</div>
					<div>
						<span>Backups kept</span>5 per mod
					</div>
					<div className="title-block-actions">
						{busy === "applying" ? (
							<CancelOperationButton />
						) : (
							<>
								<Button variant="outlined" disabled={!canRestore || Boolean(busy)} onClick={() => setConfirming("restore")}>
									Restore original
								</Button>
								<Button variant="contained" disabled={!canReplace || Boolean(busy)} onClick={() => setConfirming("replace")}>
									Install build
								</Button>
							</>
						)}
					</div>
				</div>
			</div>

			<Dialog open={Boolean(confirming)} onClose={() => setConfirming(undefined)} maxWidth="sm" fullWidth>
				<DialogTitle>{confirming === "restore" ? "Restore the original JAR?" : `Install ${jar?.fileName}?`}</DialogTitle>
				<DialogContent>
					<Typography sx={{ mb: 1 }}>Targets:</Typography>
					{confirming &&
						targetsFor(confirming).map((target) => (
							<Typography key={target} className="path-code" variant="body2">
								{target}
							</Typography>
						))}
					{confirming && serverTargeted && serverCanAct(inspection, confirming) && (
						<Alert severity="warning" sx={{ mt: 2 }}>
							The server is restarted: connected players are disconnected. If it fails to start, it is stopped and left for you to fix.
						</Alert>
					)}
				</DialogContent>
				<DialogActions>
					<Button onClick={() => setConfirming(undefined)}>Cancel</Button>
					<Button variant="contained" color="warning" onClick={() => confirming && void apply(confirming)}>
						{confirming === "restore" ? "Restore" : "Install"}
					</Button>
				</DialogActions>
			</Dialog>
		</Stack>
	);
}

type Tone = "live" | "fault" | "done" | "muted";

function Tag({ tone, children }: { tone: Tone; children: React.ReactNode }): React.JSX.Element {
	return <span className={`state-tag is-${tone}`}>{children}</span>;
}

function OptionRow(props: { control: React.ReactElement; title: string; tag?: React.ReactNode; detail?: string; detailTone?: string; dimmed?: boolean }): React.JSX.Element {
	return (
		<FormControlLabel
			className="option-row"
			sx={{ m: 0, py: 0.75, width: "100%", alignItems: "flex-start", "& .MuiFormControlLabel-label": { minWidth: 0 } }}
			control={cloneElement(props.control as React.ReactElement<{ sx?: object }>, { sx: { p: 0.25, mr: 1.25, mt: 0.1 } })}
			label={
				<span>
					<Typography component="span" className="path-code" sx={{ fontWeight: props.dimmed ? 500 : 650, color: props.dimmed ? "text.secondary" : "text.primary" }}>
						{props.title}
					</Typography>
					{props.tag}
					{props.detail && (
						<Typography variant="body2" className="path-code" sx={{ display: "block", color: props.detailTone ?? "text.secondary" }}>
							{props.detail}
						</Typography>
					)}
				</span>
			}
		/>
	);
}

function stateTag(state: ModTargetState, jar: ModJar | undefined): React.ReactNode {
	switch (state.status) {
		case "ready":
			if (jar && state.current.sha256 === jar.sha256) return <Tag tone="done">already this build</Tag>;
			return state.restore ? <Tag tone="muted">original kept</Tag> : undefined;
		case "absent":
			return <Tag tone="muted">not installed</Tag>;
		case "ambiguous":
			return <Tag tone="fault">several JARs</Tag>;
		case "running":
			return <Tag tone="live">game running</Tag>;
		case "error":
			return <Tag tone="fault">error</Tag>;
	}
}

function serverCanAct(inspection: ModsInspectResult | undefined, action: Action): boolean {
	const server = inspection?.server;
	if (!server || !("state" in server) || server.state.state.status !== "ready") return false;
	return action === "replace" || Boolean(server.state.state.restore);
}

function instanceCanAct(inspection: ModsInspectResult | undefined, id: string, action: Action): boolean {
	const state = inspection?.instances.find((instance) => instance.id === id)?.state;
	if (state?.status !== "ready") return false;
	return action === "replace" || Boolean(state.restore);
}

function describeState(state: ModTargetState): string {
	switch (state.status) {
		case "ready":
			return `${state.current.relativePath}${state.current.version ? ` (${releaseName(state.current.version)})` : ""}${state.restore ? `, original ${state.restore.fileName} can be restored` : ""}`;
		case "absent":
			return "mod not installed";
		case "ambiguous":
			return `several JARs provide it: ${state.files.join(", ")}`;
		case "running":
			return "close the game first";
		case "error":
			return state.message;
	}
}

function ResultView({ result }: { result: ModsApplyResult }): React.JSX.Element {
	const rows = [...(result.server ? [result.server] : []), ...result.instances];
	return (
		<Stack spacing={1} sx={{ mt: 2 }}>
			<Alert severity={result.status === "completed" ? "success" : "error"}>
				{result.action === "replace" ? "Installed" : "Restored"} {result.modId}
				{result.status === "completed" ? "" : ", but not everywhere"} in {formatDuration(result.durationMs)}.
			</Alert>
			{rows.map((row) => (
				<Typography key={row.label} variant="body2">
					<strong>{row.label}</strong>: {row.status}
					{row.installedFile ? `, ${row.installedFile}` : ""}
					{"startedInMs" in row && row.startedInMs !== undefined ? `, started in ${formatDuration(row.startedInMs)}` : ""}
					{row.message ? `, ${row.message}` : ""}
				</Typography>
			))}
			{result.server?.logExcerpt && <pre className="merge-block report-preview">{result.server.logExcerpt}</pre>}
		</Stack>
	);
}
