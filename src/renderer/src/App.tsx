import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Paper, Stack, Typography } from "@mui/material";
import ArrowForwardRounded from "@mui/icons-material/ArrowForwardRounded";
import { DEFAULT_SERVICE_NAME } from "@shared/connection.types";
import type { SshConnectionInput } from "@shared/deployment.types";
import { INITIAL_JOURNEY, JOURNEY_STEPS, type JourneyState, type JourneyStep, STEP_LABELS, formatDuration, hasProgress, isStepComplete, isStepUnlocked } from "@shared/journey";
import type { UpdateStatus } from "@shared/update.types";
import { api, messageOf } from "./api";
import { ConnectionPanel } from "./ConnectionPanel";
import { DeployPanel } from "./DeployPanel";
import { MergePanel } from "./MergePanel";
import { MigrationPanel } from "./MigrationPanel";
import { ModsPanel } from "./ModsPanel";
import { type ModsRun, appendEntry, runTrace } from "./mods-run";
import { RemotePathsPanel } from "./RemotePathsPanel";
import { ReportPanel } from "./ReportPanel";

const EMPTY_CONNECTION: SshConnectionInput = { host: "", port: 22, username: "", privateKeyPath: "", passphrase: "" };

type Mode = "update" | "mods";

/** The sheet title and its one-line purpose, per step of the update. */
const STEP_HEADS: Record<JourneyStep, { title: string; lede: string }> = {
	server: { title: "Choose the server", lede: "Connect with an SSH key, then pick the old server folder, which is only read, and the folder the new version goes to." },
	stop: { title: "Stop the old server", lede: "The app never starts or stops the old server. It only reads its files, so it must stay stopped until the world is migrated." },
	deploy: { title: "Deploy the new version", lede: "Unpack a GTNH server archive into the new folder, after a preflight check of the server." },
	merge: {
		title: "Carry over your changes",
		lede: "Provide the original archive of the old installation. Only files you changed since that install are proposed; everything else follows the new version.",
	},
	migrate: {
		title: "Migrate the world",
		lede: "Copies the world named by the old level-name and its server-side data listed by ServerUtilities. The old server is only read.",
	},
	report: { title: "Report", lede: "What this update did, ready to paste into your notes." },
};

export function App(): React.JSX.Element {
	const [connection, setConnection] = useState<SshConnectionInput>(EMPTY_CONNECTION);
	const [paths, setPaths] = useState({ oldServerPath: "", newServerPath: "" });
	const [serviceName, setServiceName] = useState(DEFAULT_SERVICE_NAME);
	const [mode, setMode] = useState<Mode>("update");
	const [journey, setJourney] = useState<JourneyState>(INITIAL_JOURNEY);
	const [activeStep, setActiveStep] = useState<JourneyStep>("server");
	const [startOverOpen, setStartOverOpen] = useState(false);
	const [modsRun, setModsRun] = useState<ModsRun>();
	const [update, setUpdate] = useState<UpdateStatus>();
	const [updateError, setUpdateError] = useState<string>();

	useEffect(() => api.onUpdateStatus(setUpdate), []);
	useEffect(() => api.onModsProgress((progress) => setModsRun((run) => run && appendEntry(run, progress, Date.now()))), []);

	const pathsValid = paths.oldServerPath.startsWith("/") && paths.newServerPath.startsWith("/");
	/** The server step also needs both remote paths. */
	const gates = useMemo<JourneyState>(() => ({ ...journey, serverReady: journey.serverReady && pathsValid }), [journey, pathsValid]);
	const locked = hasProgress(journey);
	const nextStep = JOURNEY_STEPS[JOURNEY_STEPS.indexOf(activeStep) + 1];

	const changeServer = (next: Partial<{ connection: SshConnectionInput; paths: typeof paths }>): void => {
		if (next.connection) setConnection(next.connection);
		if (next.paths) setPaths(next.paths);
		// Connection details changed: the server must be tested again.
		if (next.connection) setJourney((current) => ({ ...current, serverReady: false }));
	};

	const loadProfile = (profile: { oldServerPath: string; newServerPath: string; serviceName: string }): void => {
		changeServer({ paths: { oldServerPath: profile.oldServerPath, newServerPath: profile.newServerPath } });
		setServiceName(profile.serviceName);
	};

	const startOver = (): void => {
		setJourney(INITIAL_JOURNEY);
		setActiveStep("server");
		setStartOverOpen(false);
	};

	const installUpdate = async (): Promise<void> => {
		setUpdateError(undefined);
		try {
			await api.installUpdate();
		} catch (caught) {
			setUpdateError(messageOf(caught));
		}
	};

	const connectionPanel = (
		<ConnectionPanel
			connection={connection}
			oldServerPath={paths.oldServerPath}
			newServerPath={paths.newServerPath}
			locked={locked}
			serviceName={serviceName}
			onConnectionChange={(next) => changeServer({ connection: next })}
			onProfileLoaded={loadProfile}
			onTested={(ready) => setJourney((current) => ({ ...current, serverReady: ready }))}
		/>
	);

	const panel = (step: JourneyStep): React.JSX.Element => {
		switch (step) {
			case "server":
				return (
					<Stack spacing={2}>
						{locked && (
							<Alert
								severity="info"
								action={
									<Button color="inherit" onClick={() => setStartOverOpen(true)}>
										Start over
									</Button>
								}
							>
								The server is locked while an update is in progress. Starting over with another server resets the following steps.
							</Alert>
						)}
						{connectionPanel}
						<RemotePathsPanel
							connection={connection}
							oldServerPath={paths.oldServerPath}
							newServerPath={paths.newServerPath}
							locked={locked}
							onChange={(next) => changeServer({ paths: next })}
						/>
						{!gates.serverReady && <Typography sx={{ color: "text.secondary" }}>Test the connection and choose both absolute remote paths to continue.</Typography>}
					</Stack>
				);
			case "stop":
				return (
					<Paper className="section-card" sx={{ p: 2 }}>
						<FormControlLabel
							control={
								<Checkbox
									checked={journey.stopConfirmed}
									disabled={Boolean(journey.deployment)}
									onChange={(event) => setJourney((current) => ({ ...current, stopConfirmed: event.target.checked }))}
								/>
							}
							label="I stopped the old server"
						/>
					</Paper>
				);
			case "deploy":
				return (
					<DeployPanel
						connection={connection}
						oldServerPath={paths.oldServerPath}
						newServerPath={paths.newServerPath}
						record={journey.deployment}
						onDeployed={(record) => setJourney((current) => ({ ...current, deployment: record }))}
					/>
				);
			case "merge":
				return (
					<MergePanel
						connection={connection}
						oldServerPath={paths.oldServerPath}
						newServerPath={paths.newServerPath}
						record={journey.merge}
						deployment={journey.deployment}
						stopConfirmed={journey.stopConfirmed}
						onFinished={(record) => setJourney((current) => ({ ...current, merge: record }))}
					/>
				);
			case "migrate":
				return (
					<MigrationPanel
						connection={connection}
						oldServerPath={paths.oldServerPath}
						newServerPath={paths.newServerPath}
						oldServerStopped={journey.stopConfirmed}
						record={journey.migration}
						onFinished={(record) => setJourney((current) => ({ ...current, migration: record }))}
					/>
				);
			case "report":
				return (
					<ReportPanel
						connection={connection}
						active={mode === "update" && activeStep === "report"}
						report={{
							host: connection.host,
							username: connection.username,
							oldServerPath: paths.oldServerPath,
							newServerPath: paths.newServerPath,
							state: journey,
						}}
					/>
				);
		}
	};

	const head = mode === "update" ? STEP_HEADS[activeStep] : MODS_HEAD;

	return (
		<div className="shell">
			<aside className="rail">
				<div className="mark">
					<Mark />
					<h1>
						GTNH Server
						<br />
						Updater
					</h1>
				</div>
				<nav className="modes" aria-label="Mode">
					<ModeButton mode="update" current={mode} onSelect={setMode}>
						Server update
					</ModeButton>
					<ModeButton mode="mods" current={mode} onSelect={setMode}>
						Mods
					</ModeButton>
				</nav>
				{mode === "update" ? (
					<section aria-label="Update steps">
						<h2>Update steps</h2>
						<ol className="trace">
							{JOURNEY_STEPS.map((step, index) => {
								const unlocked = isStepUnlocked(gates, step);
								const done = isStepComplete(gates, step);
								const state = done ? "is-done" : step === activeStep ? "is-live" : unlocked ? "is-todo" : "is-locked";
								return (
									<li key={step} className={`${state}${step === activeStep ? " is-current" : ""}`}>
										<button
											type="button"
											className="trace-item"
											disabled={!unlocked}
											aria-current={step === activeStep ? "step" : undefined}
											onClick={() => setActiveStep(step)}
										>
											<span className="trace-node">{index + 1}</span>
											<span>
												<span className="trace-label">{STEP_LABELS[step]}</span>
												{stepDetail(journey, connection, step) && <span className="trace-detail">{stepDetail(journey, connection, step)}</span>}
											</span>
										</button>
									</li>
								);
							})}
						</ol>
					</section>
				) : (
					<section aria-label="This run">
						<h2>{modsRun ? (modsRun.action === "restore" ? "This restore" : "This install") : "How a swap runs"}</h2>
						<ol className="trace">
							{runTrace(modsRun).map((step, index) => (
								<li key={step.label} className={`is-${step.state === "skipped" ? "locked" : step.state}`}>
									<div className="trace-item">
										<span className="trace-node">{index + 1}</span>
										<span>
											<span className="trace-label">{step.label}</span>
											{step.detail && <span className="trace-detail">{step.detail}</span>}
										</span>
									</div>
								</li>
							))}
						</ol>
					</section>
				)}
				<div className="rail-foot">
					<Button size="small" onClick={() => void api.openLogs()}>
						Open logs
					</Button>
					<Typography variant="caption" sx={{ color: "text.secondary", px: 1.25 }}>
						SSH key only, never sudo
					</Typography>
				</div>
			</aside>

			<main className="sheet">
				{update?.state === "ready" && (
					<Alert
						severity="info"
						sx={{ mb: 3 }}
						action={
							<Button color="inherit" onClick={() => void installUpdate()}>
								Restart to update
							</Button>
						}
					>
						Version {update.version} is ready. It is installed when you restart, or automatically when you quit.
					</Alert>
				)}
				{updateError && (
					<Alert severity="warning" sx={{ mb: 3 }}>
						{updateError}
					</Alert>
				)}

				<header className="sheet-head">
					<h2>{head.title}</h2>
					<p>{head.lede}</p>
				</header>

				<div hidden={mode !== "update"}>
					<Stack spacing={2}>
						{JOURNEY_STEPS.map((step) => (
							<div key={step} hidden={step !== activeStep}>
								{panel(step)}
							</div>
						))}
						{nextStep && (
							<Stack direction="row" sx={{ justifyContent: "flex-end" }}>
								<Button
									variant="contained"
									size="large"
									endIcon={<ArrowForwardRounded />}
									disabled={!isStepComplete(gates, activeStep)}
									onClick={() => setActiveStep(nextStep)}
								>
									Next: {STEP_LABELS[nextStep]}
								</Button>
							</Stack>
						)}
					</Stack>
				</div>

				<div hidden={mode !== "mods"}>
					<ModsPanel
						connection={connection}
						serverReady={journey.serverReady}
						serviceName={serviceName}
						onServiceNameChange={setServiceName}
						run={modsRun}
						onRunStart={(action) => setModsRun({ action, entries: [] })}
						connectionPanel={connectionPanel}
					/>
				</div>
			</main>

			<Dialog open={startOverOpen} onClose={() => setStartOverOpen(false)} maxWidth="xs" fullWidth>
				<DialogTitle>Start over?</DialogTitle>
				<DialogContent>
					<Typography>All steps after the server are reset. Files already written on the new server stay where they are.</Typography>
				</DialogContent>
				<DialogActions>
					<Button onClick={() => setStartOverOpen(false)}>Cancel</Button>
					<Button variant="contained" color="warning" onClick={startOver}>
						Start over
					</Button>
				</DialogActions>
			</Dialog>
		</div>
	);
}

const MODS_HEAD = {
	title: "Swap a mod",
	lede: "Install your own build of a mod on the server and on Prism instances. The server goes first; instances follow only once it has started.",
};

function ModeButton({ mode, current, onSelect, children }: { mode: Mode; current: Mode; onSelect(mode: Mode): void; children: React.ReactNode }): React.JSX.Element {
	return (
		<button type="button" aria-current={mode === current ? "page" : undefined} onClick={() => onSelect(mode)}>
			{children}
		</button>
	);
}

/** The app icon, drawn in ink so it sits on the rail like a stamp. */
function Mark(): React.JSX.Element {
	return (
		<svg width="44" height="44" viewBox="0 0 1024 1024" aria-hidden="true">
			<rect x="48" y="48" width="928" height="928" rx="200" fill="#16324e" />
			<g fill="#e8eef1">
				<path d="M224 288h192v64H224zM160 352h64v320h-64zM416 352h64v64h-64zM288 480h192v64H288zM416 544h64v128h-64zM224 672h192v64H224z" />
				<path d="M544 288h320v64H544zM672 352h64v384h-64z" />
			</g>
		</svg>
	);
}

function stepDetail(journey: JourneyState, connection: SshConnectionInput, step: JourneyStep): string | undefined {
	switch (step) {
		case "server":
			return journey.serverReady && connection.host ? `${connection.username}@${connection.host}` : undefined;
		case "stop":
			return journey.stopConfirmed ? "confirmed" : undefined;
		case "deploy":
			return journey.deployment ? `${journey.deployment.result.status} in ${formatDuration(journey.deployment.durationMs)}` : undefined;
		case "merge":
			return journey.merge?.status === "skipped"
				? "skipped"
				: journey.merge
					? `${journey.merge.copiedPaths.length + journey.merge.mergedPaths.length} files carried over`
					: undefined;
		case "migrate":
			return journey.migration?.status === "skipped" ? "skipped" : journey.migration ? journey.migration.worldName : undefined;
		case "report":
			return undefined;
	}
}
