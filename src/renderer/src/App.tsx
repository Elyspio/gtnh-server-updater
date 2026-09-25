import { useEffect, useMemo, useState } from "react";
import {
	Alert,
	Box,
	Button,
	Checkbox,
	Chip,
	Container,
	Dialog,
	DialogActions,
	DialogContent,
	DialogTitle,
	FormControlLabel,
	Paper,
	Stack,
	Step,
	StepButton,
	Stepper,
	Typography,
} from "@mui/material";
import ArrowForwardRounded from "@mui/icons-material/ArrowForwardRounded";
import DescriptionRounded from "@mui/icons-material/DescriptionRounded";
import SecurityRounded from "@mui/icons-material/SecurityRounded";
import type { SshConnectionInput } from "@shared/deployment.types";
import { INITIAL_JOURNEY, JOURNEY_STEPS, type JourneyState, type JourneyStep, STEP_LABELS, hasProgress, isStepComplete, isStepUnlocked } from "@shared/journey";
import type { UpdateStatus } from "@shared/update.types";
import { api, messageOf } from "./api";
import { ConnectionPanel } from "./ConnectionPanel";
import { DeployPanel } from "./DeployPanel";
import { MergePanel } from "./MergePanel";
import { MigrationPanel } from "./MigrationPanel";
import { RemotePathsPanel } from "./RemotePathsPanel";
import { ReportPanel } from "./ReportPanel";

const EMPTY_CONNECTION: SshConnectionInput = { host: "", port: 22, username: "", privateKeyPath: "", passphrase: "" };

export function App(): React.JSX.Element {
	const [connection, setConnection] = useState<SshConnectionInput>(EMPTY_CONNECTION);
	const [paths, setPaths] = useState({ oldServerPath: "", newServerPath: "" });
	const [journey, setJourney] = useState<JourneyState>(INITIAL_JOURNEY);
	const [activeStep, setActiveStep] = useState<JourneyStep>("server");
	const [startOverOpen, setStartOverOpen] = useState(false);
	const [update, setUpdate] = useState<UpdateStatus>();
	const [updateError, setUpdateError] = useState<string>();

	useEffect(() => api.onUpdateStatus(setUpdate), []);

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

	const panel = (step: JourneyStep): React.JSX.Element => {
		switch (step) {
			case "server":
				return (
					<Stack spacing={3}>
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
						<ConnectionPanel
							connection={connection}
							oldServerPath={paths.oldServerPath}
							newServerPath={paths.newServerPath}
							locked={locked}
							onConnectionChange={(next) => changeServer({ connection: next })}
							onProfileLoaded={(profile) => changeServer({ paths: { oldServerPath: profile.oldServerPath, newServerPath: profile.newServerPath } })}
							onTested={(ready) => setJourney((current) => ({ ...current, serverReady: ready }))}
						/>
						<RemotePathsPanel
							connection={connection}
							oldServerPath={paths.oldServerPath}
							newServerPath={paths.newServerPath}
							locked={locked}
							onChange={(next) => changeServer({ paths: next })}
						/>
						{!gates.serverReady && (
							<Typography
								sx={{
									color: "text.secondary",
								}}
							>
								Test the connection and choose both absolute remote paths to continue.
							</Typography>
						)}
					</Stack>
				);
			case "stop":
				return (
					<Paper className="section-card" elevation={0} sx={{ p: 3 }}>
						<Typography variant="h6" gutterBottom>
							Stop the old server
						</Typography>
						<Typography
							sx={{
								color: "text.secondary",
								mb: 2,
							}}
						>
							Stop the old server yourself before going further. The app never starts or stops it and only reads its files; it must stay stopped until the world is
							migrated.
						</Typography>
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

	return (
		<Container maxWidth="lg" sx={{ py: 5 }}>
			<Stack spacing={3}>
				<Stack
					direction="row"
					spacing={2}
					sx={{
						alignItems: "center",
					}}
				>
					<Box className="brand-mark">GT</Box>
					<Box>
						<Typography variant="h4">GTNH Server Updater</Typography>
						<Typography
							sx={{
								color: "text.secondary",
							}}
						>
							Deploy a clean remote server, then carry over the files you changed.
						</Typography>
					</Box>
					<Chip icon={<SecurityRounded />} label="SSH key only · no sudo" variant="outlined" sx={{ ml: "auto !important" }} />
					<Button startIcon={<DescriptionRounded />} onClick={() => void api.openLogs()}>
						Open logs
					</Button>
				</Stack>

				{update?.state === "ready" && (
					<Alert
						severity="info"
						action={
							<Button color="inherit" onClick={() => void installUpdate()}>
								Restart to update
							</Button>
						}
					>
						Version {update.version} is ready. It is installed when you restart, or automatically when you quit.
					</Alert>
				)}
				{updateError && <Alert severity="warning">{updateError}</Alert>}

				<Stepper nonLinear activeStep={JOURNEY_STEPS.indexOf(activeStep)} className="journey-stepper">
					{JOURNEY_STEPS.map((step) => (
						<Step key={step} completed={isStepComplete(gates, step)} disabled={!isStepUnlocked(gates, step)}>
							<StepButton onClick={() => setActiveStep(step)} optional={skippedLabel(journey, step)}>
								{STEP_LABELS[step]}
							</StepButton>
						</Step>
					))}
				</Stepper>

				{JOURNEY_STEPS.map((step) => (
					<Box key={step} sx={{ display: step === activeStep ? "block" : "none" }}>
						{panel(step)}
					</Box>
				))}

				{nextStep && (
					<Stack
						direction="row"
						sx={{
							justifyContent: "flex-end",
						}}
					>
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
		</Container>
	);
}

function skippedLabel(journey: JourneyState, step: JourneyStep): React.ReactNode {
	const skipped = (step === "merge" && journey.merge?.status === "skipped") || (step === "migrate" && journey.migration?.status === "skipped");
	return skipped ? (
		<Typography
			variant="caption"
			sx={{
				color: "text.secondary",
			}}
		>
			Skipped
		</Typography>
	) : undefined;
}
