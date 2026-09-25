import { useMemo, useState } from "react";
import { Container, Paper, Stack, Typography } from "@mui/material";
import type { MergeDecision, MergeFileEntry, MergeFileKind } from "@shared/merge.types";
import { defaultDecisions } from "@shared/merge-model";
import { JourneyContextSummary } from "./JourneyContextSummary";
import { MergeFileList } from "./MergeFileList";

const KINDS: MergeFileKind[] = ["user-modified", "conflict", "user-added", "removed-by-new"];

/** Renders the file list alone with many entries (open the app with ?fixture=merge-list). */
export function MergeListFixture(): React.JSX.Element {
  const files = useMemo<MergeFileEntry[]>(() => Array.from({ length: 248 }, (_value, index) => ({
    path: `config/${["", "AppliedEnergistics2/", "BloodMagic/", "GregTech/"][index % 4]}module-${index}.cfg`,
    kind: KINDS[index % KINDS.length]!,
  })), []);
  const [decisions, setDecisions] = useState<Map<string, MergeDecision>>(() => defaultDecisions(files));

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Paper className="section-card" elevation={0} sx={{ p: 3 }}>
        <Stack spacing={2}>
          <Typography variant="h6">Merge list fixture: {files.length} files</Typography>
          <JourneyContextSummary
            connection={{ host: "10.0.0.59", port: 22, username: "root", privateKeyPath: "C:/Users/jonag/.ssh/id_ed25519" }}
            oldServerPath="/data/gtnh/daily-731"
            newServerPath="/data/gtnh/daily-746"
            stopConfirmed
            deployment={{
              archive: "daily-2026-09-19+746 · GTNH-daily-2026-09-19+746-server-java17-26.zip (526 MiB)",
              result: { operationId: "x", status: "completed", destinationPath: "/data/gtnh/daily-746", partialDestinationPreserved: false },
              durationMs: 96_000,
            }}
          />
          <MergeFileList
            files={files}
            decisions={decisions}
            busy={false}
            onDecide={(path, action) => setDecisions((current) => new Map(current).set(path, { path, action }))}
            onDecideGroup={(group, action) => setDecisions((current) => {
              const next = new Map(current);
              for (const file of group) next.set(file.path, { path: file.path, action });
              return next;
            })}
            onOpen={() => undefined}
          />
        </Stack>
      </Paper>
    </Container>
  );
}
