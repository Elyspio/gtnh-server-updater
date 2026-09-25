import { useEffect, useState } from "react";
import { Alert, Box, Button, Chip, CircularProgress, LinearProgress, Paper, Stack, TextField, Typography } from "@mui/material";
import RocketLaunchRounded from "@mui/icons-material/RocketLaunchRounded";
import type { DeploymentPreflightResult, DeploymentProgress, SshConnectionInput } from "@shared/deployment.types";
import type { DeploymentRecord } from "@shared/journey";
import { api, messageOf } from "./api";
import { ArchiveSourceField, type ArchiveChoice } from "./ArchiveSourceField";
import { CancelOperationButton } from "./CancelOperationButton";
import { formatBytes } from "./format";

type Props = {
	connection: SshConnectionInput;
	oldServerPath: string;
	newServerPath: string;
	record?: DeploymentRecord;
	onDeployed(record: DeploymentRecord): void;
};

export function DeployPanel({ connection, oldServerPath, newServerPath, record, onDeployed }: Props): React.JSX.Element {
	const [choice, setChoice] = useState<ArchiveChoice>();
	const [preflight, setPreflight] = useState<DeploymentPreflightResult>();
	const [confirmation, setConfirmation] = useState("");
	const [progress, setProgress] = useState<DeploymentProgress>();
	const [error, setError] = useState<string>();
	const [busy, setBusy] = useState(false);

	useEffect(() => api.onProgress(setProgress), []);

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

	const reset = (): void => {
		setPreflight(undefined);
		setConfirmation("");
	};

	const runPreflight = (): Promise<void> =>
		run(async () => {
			reset();
			if (!choice) return;
			setPreflight(await api.preflight({ connection, source: choice.source, oldServerPath, destinationPath: newServerPath }));
		});

	const deploy = (): Promise<void> =>
		run(async () => {
			if (!preflight) return;
			const started = Date.now();
			const result = await api.execute({ operationId: preflight.operationId, confirmationPath: confirmation || undefined });
			reset();
			onDeployed({ archive: choice?.label ?? "", result, durationMs: Date.now() - started });
			if (result.status === "failed") setError(result.error ?? "Deployment failed");
		});

	const deployed = record?.result.status === "completed";
	const confirmationMissing = Boolean(preflight?.destinationNonEmpty && confirmation !== preflight.resolvedDestinationPath);
	const percent = progress?.totalBytes ? Math.round(((progress.transferredBytes ?? 0) / progress.totalBytes) * 100) : undefined;

	return (
		<Stack spacing={2}>
			{deployed && <Alert severity="success">Server archive deployed to {record!.result.destinationPath}.</Alert>}
			{error && <Alert severity="error">{error}</Alert>}
			{record?.result.status === "failed" && (
				<Alert severity="warning">
					{record.result.partialDestinationPreserved
						? `Partial files were kept at ${record.result.destinationPath}. Run the preflight again to redeploy.`
						: "The destination was not modified. Run the preflight again to retry."}{" "}
					The temporary ZIP was removed and the old server was not modified.
				</Alert>
			)}
			<Paper className="section-card" elevation={0} sx={{ p: 3 }}>
				<ArchiveSourceField
					title="New server archive"
					localLabel="Local ZIP path (uploaded over SFTP)"
					urlLabel="Public HTTPS URL"
					choice={choice}
					disabled={deployed || busy}
					onChange={(next) => {
						setChoice(next);
						reset();
					}}
				/>
				<Typography
					className="path-code"
					variant="body2"
					sx={{
						color: "text.secondary",
						mt: 1,
					}}
				>
					Destination: {newServerPath}
				</Typography>
			</Paper>
			{busy && progress && (
				<Paper className="section-card" elevation={0} sx={{ p: 2 }}>
					<Stack
						direction="row"
						spacing={2}
						sx={{
							alignItems: "center",
						}}
					>
						<CircularProgress size={20} />
						<Box sx={{ flex: 1 }}>
							<Typography
								sx={{
									fontWeight: 700,
								}}
							>
								{progress.message}
							</Typography>
							{percent !== undefined && <LinearProgress variant="determinate" value={percent} sx={{ mt: 1 }} />}
						</Box>
						{progress.totalBytes && (
							<Typography>
								{formatBytes(progress.transferredBytes ?? 0)} / {formatBytes(progress.totalBytes)}
							</Typography>
						)}
					</Stack>
				</Paper>
			)}
			{preflight && (
				<Paper className="section-card" elevation={0} sx={{ p: 3 }}>
					<Typography variant="h6">Preflight passed</Typography>
					<Stack
						direction="row"
						spacing={1}
						useFlexGap
						sx={{
							flexWrap: "wrap",
							my: 2,
						}}
					>
						<Chip label={`${formatBytes(preflight.compressedBytes)} ZIP`} />
						<Chip label={`${formatBytes(preflight.uncompressedBytes)} extracted`} />
						<Chip label={`${formatBytes(preflight.availableFreeBytes)} available`} color="success" />
					</Stack>
					<Typography
						className="path-code"
						sx={{
							color: "text.secondary",
						}}
					>
						Resolved destination:{" "}
						<Typography component="span" color={"secondary"}>
							{preflight.resolvedDestinationPath}
						</Typography>
					</Typography>
					{preflight.destinationNonEmpty && (
						<Box sx={{ mt: 2 }}>
							<Alert severity="warning" sx={{ mb: 2 }}>
								The existing destination is not empty and will be permanently deleted.
							</Alert>
							<Typography variant="body2" sx={{ mb: 1 }}>
								Preview:{" "}
								{preflight.destinationPreview
									.slice(0, 8)
									.map((entry) => entry.name)
									.join(", ")}
							</Typography>
							<TextField fullWidth label="Type the exact resolved destination path" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
						</Box>
					)}
				</Paper>
			)}
			<Stack
				direction="row"
				spacing={2}
				sx={{
					justifyContent: "flex-end",
				}}
			>
				{busy && <CancelOperationButton />}
				<Button variant="outlined" size="large" disabled={deployed || busy || !choice} onClick={() => void runPreflight()}>
					Run preflight
				</Button>
				<Button
					variant="contained"
					size="large"
					startIcon={<RocketLaunchRounded />}
					disabled={deployed || !preflight || busy || confirmationMissing}
					onClick={() => void deploy()}
				>
					Deploy archive
				</Button>
			</Stack>
		</Stack>
	);
}
