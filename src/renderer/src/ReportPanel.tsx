import { useMemo, useState } from "react";
import { Alert, Button, Paper, Stack, Typography } from "@mui/material";
import SaveAltRounded from "@mui/icons-material/SaveAltRounded";
import { type JourneyReport, buildReportMarkdown } from "@shared/journey";
import { api, messageOf } from "./api";

type Props = { report: Omit<JourneyReport, "generatedAt"> };

export function ReportPanel({ report }: Props): React.JSX.Element {
  const [saved, setSaved] = useState<string>();
  const [error, setError] = useState<string>();
  const markdown = useMemo(() => buildReportMarkdown({ ...report, generatedAt: new Date() }), [report]);

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
    <Paper className="section-card" elevation={0} sx={{ p: 3 }}>
      <Stack direction="row" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h6">Update report</Typography>
        <Stack direction="row" spacing={1} sx={{ ml: "auto" }}>
          <Button onClick={() => void api.openLogs()}>Open logs</Button>
          <Button variant="contained" startIcon={<SaveAltRounded />} onClick={() => void save()}>Save report</Button>
        </Stack>
      </Stack>
      {saved && <Alert severity="success" sx={{ mb: 2 }}>Report saved to {saved}</Alert>}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <pre className="merge-block report-preview">{markdown}</pre>
    </Paper>
  );
}
