import { Accordion, AccordionDetails, AccordionSummary, Chip, Stack, Typography } from "@mui/material";
import ExpandMoreRounded from "@mui/icons-material/ExpandMoreRounded";
import type { SshConnectionInput } from "@shared/deployment.types";
import type { DeploymentRecord } from "@shared/journey";
import { formatDuration } from "@shared/journey";

type Props = {
  connection: SshConnectionInput;
  oldServerPath: string;
  newServerPath: string;
  deployment?: DeploymentRecord;
  stopConfirmed: boolean;
};

/** Everything chosen in the previous steps, folded away until it is needed. */
export function JourneyContextSummary({ connection, oldServerPath, newServerPath, deployment, stopConfirmed }: Props): React.JSX.Element {
  const rows: Array<[string, string]> = [
    ["Server", `${connection.username}@${connection.host}:${connection.port}`],
    ["Private key", connection.privateKeyPath],
    ["Old server (read only)", oldServerPath],
    ["New server", newServerPath],
    ["Old server stopped", stopConfirmed ? "confirmed" : "not confirmed"],
  ];
  if (deployment) {
    rows.push(
      ["Deployed archive", deployment.archive],
      ["Deployment", `${deployment.result.status} in ${formatDuration(deployment.durationMs)}`],
    );
  }

  return (
    <Accordion className="context-summary" disableGutters elevation={0}>
      <AccordionSummary expandIcon={<ExpandMoreRounded />}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography fontWeight={700}>Chosen so far</Typography>
          <Chip size="small" label={`${connection.username}@${connection.host}`} />
          <Chip size="small" className="path-code" label={newServerPath} />
        </Stack>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={0.5}>
          {rows.map(([label, value]) => (
            <Stack key={label} direction="row" spacing={2}>
              <Typography variant="body2" color="text.secondary" sx={{ minWidth: 190 }}>{label}</Typography>
              <Typography variant="body2" className="path-code" sx={{ wordBreak: "break-all" }}>{value || "—"}</Typography>
            </Stack>
          ))}
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}
