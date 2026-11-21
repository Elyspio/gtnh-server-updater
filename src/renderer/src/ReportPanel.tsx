import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Paper, Stack, Typography } from "@mui/material";
import SaveAltRounded from "@mui/icons-material/SaveAltRounded";
import type { SshConnectionInput } from "@shared/deployment.types";
import { type JourneyReport, buildReportMarkdown } from "@shared/journey";
import { api, messageOf } from "./api";

type Props = { report: Omit<JourneyReport, "generatedAt" | "customMods">; connection: SshConnectionInput; active: boolean };

export function ReportPanel({ report, connection, active }: Props): React.JSX.Element {
	const [saved, setSaved] = useState<string>();
	const [error, setError] = useState<string>();
	const [customMods, setCustomMods] = useState<JourneyReport["customMods"]>();
	const markdown = useMemo(() => buildReportMarkdown({ ...report, customMods, generatedAt: new Date() }), [report, customMods]);

	// Mods replaced by hand are never carried over: the report names those still active in the old server.
	const oldServerPath = report.oldServerPath;
	useEffect(() => {
		if (!active || !connection.host || !oldServerPath.startsWith("/")) return;
		let current = true;
		api.activeCustomMods(connection, oldServerPath)
			.then((mods) => current && setCustomMods(mods))
			.catch((caught: unknown) => current && setCustomMods({ error: messageOf(caught) }));
		return () => {
			current = false;
		};
	}, [active, connection, oldServerPath]);

	const save = async (): Promise<void> => {
		setError(undefined);
		try {
			const date = new Date().toISOString().slice(0, 10);
			const path = await api.saveReport(markdown, `gtnh-update-report-${date}.md`);
			if (path) setSaved(path);
		} catch (caught) {
			setError(messageOf(caught));
		}
	};

	return (
		<Paper className="section-card" elevation={0} sx={{ p: 2 }}>
			<Stack
				direction="row"
				sx={{
					alignItems: "center",
					mb: 2,
				}}
			>
				<Typography variant="h6">Update report</Typography>
				<Stack direction="row" spacing={1} sx={{ ml: "auto" }}>
					<Button onClick={() => void api.openLogs()}>Open logs</Button>
					<Button variant="contained" startIcon={<SaveAltRounded />} onClick={() => void save()}>
						Save report
					</Button>
				</Stack>
			</Stack>
			{saved && (
				<Alert severity="success" sx={{ mb: 2 }}>
					Report saved to {saved}
				</Alert>
			)}
			{error && (
				<Alert severity="error" sx={{ mb: 2 }}>
					{error}
				</Alert>
			)}
			<pre className="merge-block report-preview">{markdown}</pre>
		</Paper>
	);
}
