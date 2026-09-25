import { useEffect, useState } from "react";
import { Alert, Box, Button, Chip, CircularProgress, Paper, Stack, TextField, Typography } from "@mui/material";
import PublicRounded from "@mui/icons-material/PublicRounded";
import type { SshConnectionInput } from "@shared/deployment.types";
import type { MigrationPrepareResult, MigrationProgress, MigrationResult } from "@shared/migration.types";
import type { MigrationRecord } from "@shared/journey";
import { api, messageOf } from "./api";
import { CancelOperationButton } from "./CancelOperationButton";
import { SkipStepButton } from "./SkipStepButton";
import { formatBytes } from "./format";

type Props = {
	connection: SshConnectionInput;
	oldServerPath: string;
	newServerPath: string;
	oldServerStopped: boolean;
	record?: MigrationRecord;
	onFinished(record: MigrationRecord): void;
};

export function MigrationPanel({ connection, oldServerPath, newServerPath, oldServerStopped, record, onFinished }: Props): React.JSX.Element {
	const [prepared, setPrepared] = useState<MigrationPrepareResult>();
	const [confirmation, setConfirmation] = useState("");
	const [progress, setProgress] = useState<MigrationProgress>();
	const [result, setResult] = useState<MigrationResult>();
	const [error, setError] = useState<string>();
	const [busy, setBusy] = useState(false);

	useEffect(() => api.onMigrationProgress(setProgress), []);
	// A preparation is only valid for the inputs it was made with.
	const inputs = { connection, oldServerPath, newServerPath, oldServerStopped };
	const [preparedFor, setPreparedFor] = useState(inputs);
	if (
		preparedFor.connection !== connection ||
		preparedFor.oldServerPath !== oldServerPath ||
		preparedFor.newServerPath !== newServerPath ||
		preparedFor.oldServerStopped !== oldServerStopped
	) {
		setPreparedFor(inputs);
		setPrepared(undefined);
		setConfirmation("");
	}

	const canPrepare = oldServerStopped && record?.status !== "skipped" && Boolean(connection.host.trim()) && oldServerPath.startsWith("/") && newServerPath.startsWith("/");
	const confirmationMissing = Boolean(prepared?.replacementConfirmationPath && confirmation !== prepared.replacementConfirmationPath);

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

	const prepare = (): Promise<void> =>
		run(async () => {
			setResult(undefined);
			setPrepared(await api.prepareMigration({ connection, oldServerPath, newServerPath, oldServerStoppedConfirmed: oldServerStopped }));
		});

	const execute = (): Promise<void> =>
		run(async () => {
			if (!prepared) return;
			const started = Date.now();
			const next = await api.executeMigration({ operationId: prepared.operationId, confirmationPath: confirmation || undefined });
			setResult(next);
			onFinished({ status: "done", worldName: prepared.worldName, result: next, durationMs: Date.now() - started });
			if (next.status === "completed") setPrepared(undefined);
			else setError(next.error ?? "World migration failed");
		});

	return (
		<Paper className="section-card" elevation={0} sx={{ p: 3 }}>
			<Typography variant="h6">Migrate the world</Typography>
			<Typography
				sx={{
					color: "text.secondary",
					mb: 2,
				}}
			>
				Copies the world named by the old level-name and its server-side data listed by ServerUtilities. The old server is only read.
			</Typography>
			{error && (
				<Alert severity="error" sx={{ mb: 2 }}>
					{error}
				</Alert>
			)}
			{result?.status === "completed" && (
				<Alert severity="success" sx={{ mb: 2 }}>
					Copied {result.copiedPaths.join(", ")}.{result.levelNameRewritten ? " level-name updated in the new server.properties." : ""}
				</Alert>
			)}
			{result?.status === "failed" && (
				<Alert severity="warning" sx={{ mb: 2 }}>
					Stopped at {result.failedPath}. Copied: {result.copiedPaths.join(", ") || "nothing"}.{result.partialPath && ` Partial files kept at ${result.partialPath}.`} The
					old server was not modified.
				</Alert>
			)}
			<Stack
				direction="row"
				spacing={2}
				sx={{
					alignItems: "center",
				}}
			>
				<Button variant="outlined" disabled={!canPrepare || busy} onClick={() => void prepare()}>
					Check world migration
				</Button>
				{busy && <CircularProgress size={20} />}
				{busy && <CancelOperationButton />}
				{!busy && (!record || (record.status === "done" && record.result.status === "failed")) && (
					<SkipStepButton
						label="Skip world migration"
						detail="No world or world data is copied. The new server will start with the world named in its server.properties."
						onSkip={() => {
							setPrepared(undefined);
							onFinished({ status: "skipped" });
						}}
					/>
				)}
				{progress && (
					<Typography
						sx={{
							color: "text.secondary",
						}}
					>
						{progress.message}
					</Typography>
				)}
			</Stack>
			{prepared && (
				<Box sx={{ mt: 3 }}>
					<Stack
						direction="row"
						spacing={1}
						useFlexGap
						sx={{
							flexWrap: "wrap",
							mb: 2,
						}}
					>
						<Chip label={`World: ${prepared.worldName}`} color="primary" />
						<Chip label={`${formatBytes(prepared.requiredFreeBytes)} required`} />
						<Chip label={`${formatBytes(prepared.availableFreeBytes)} available`} color="success" />
					</Stack>
					{prepared.dataListWarning && (
						<Alert severity="warning" sx={{ mb: 1 }}>
							{prepared.dataListWarning}
						</Alert>
					)}
					{prepared.levelNameChange && (
						<Alert severity="info" sx={{ mb: 1 }}>
							The new server.properties uses level-name "{prepared.levelNameChange.from}"; it will be set to "{prepared.levelNameChange.to}".
						</Alert>
					)}
					{prepared.ignoredWorlds.length > 0 && (
						<Alert severity="info" sx={{ mb: 1 }}>
							Other worlds not copied: {prepared.ignoredWorlds.join(", ")}
						</Alert>
					)}
					{prepared.missingDataPaths.length > 0 && (
						<Alert severity="info" sx={{ mb: 1 }}>
							Not found in the old server: {prepared.missingDataPaths.join(", ")}
						</Alert>
					)}

					<Stack spacing={0.5} sx={{ my: 2 }}>
						{prepared.items.map((item) => (
							<Stack
								key={item.path}
								direction="row"
								spacing={1}
								className="merge-row"
								sx={{
									alignItems: "center",
								}}
							>
								<Typography className="path-code" sx={{ flex: 1 }}>
									{item.path}
								</Typography>
								<Chip size="small" label={item.role === "world" ? "World" : "World data"} />
								<Typography
									variant="body2"
									sx={{
										color: "text.secondary",
									}}
								>
									{item.files} files · {formatBytes(item.bytes)}
								</Typography>
								{item.existsInNewServer && <Chip size="small" color="warning" label="Will replace" />}
							</Stack>
						))}
					</Stack>

					{prepared.replacementConfirmationPath && (
						<Box sx={{ mb: 2 }}>
							<Alert severity="warning" sx={{ mb: 2 }}>
								Existing copies in the new server will be permanently replaced.
							</Alert>
							<TextField
								fullWidth
								label={`Type ${prepared.replacementConfirmationPath} to authorize replacement`}
								value={confirmation}
								onChange={(event) => setConfirmation(event.target.value)}
							/>
						</Box>
					)}

					<Stack
						direction="row"
						sx={{
							justifyContent: "flex-end",
						}}
					>
						<Button variant="contained" size="large" startIcon={<PublicRounded />} disabled={busy || confirmationMissing} onClick={() => void execute()}>
							Copy world
						</Button>
					</Stack>
				</Box>
			)}
		</Paper>
	);
}
