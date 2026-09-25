import { useState } from "react";
import { Container, Paper } from "@mui/material";
import type { ReleaseSummary } from "@shared/releases.types";
import { ArchiveSourceField, type ArchiveChoice } from "./ArchiveSourceField";

const SAMPLE: ReleaseSummary[] = Array.from({ length: 8 }, (_value, index) => {
	const tag = `daily-2026-09-${19 - index}+${746 - index}`;
	const name = `GTNH-${tag}-server-java17-26.zip`;
	return {
		tag,
		name: tag,
		publishedAt: `2026-09-${19 - index}T10:00:00Z`,
		assets: [{ name, url: `https://github.com/GTNewHorizons/GTNH-Daily-Builds/releases/download/${tag}/${name}`, size: 551_517_584 }],
		recommended: { name, url: `https://github.com/GTNewHorizons/GTNH-Daily-Builds/releases/download/${tag}/${name}`, size: 551_517_584 },
	};
});

/** Installs a stubbed bridge when the fixture runs outside Electron. */
export function installArchiveSourceBridge(): void {
	if (typeof window.gtnh === "object") return;
	window.gtnh = {
		invoke: async (channel: string) => (channel === "releases:list" ? SAMPLE : null),
		on: () => () => undefined,
	} as Window["gtnh"];
}

/** Shows the archive source field with a stubbed bridge (app with ?fixture=archive-source). */
export function ArchiveSourceFixture(): React.JSX.Element {
	const [choice, setChoice] = useState<ArchiveChoice>();
	return (
		<Container maxWidth="md" sx={{ py: 4 }}>
			<Paper className="section-card" elevation={0} sx={{ p: 3 }}>
				<ArchiveSourceField title="New server archive" localLabel="Local ZIP path" urlLabel="Public HTTPS URL" choice={choice} disabled={false} onChange={setChoice} />
			</Paper>
		</Container>
	);
}
