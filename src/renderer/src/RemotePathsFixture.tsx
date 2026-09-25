import { useState } from "react";
import { Container } from "@mui/material";
import type { RemoteDirectoryEntry, SshConnectionInput } from "@shared/deployment.types";
import type { LatestVersions } from "@shared/releases.types";
import { RemotePathsPanel } from "./RemotePathsPanel";

const CONNECTION: SshConnectionInput = { host: "gtnh.example.test", port: 22, username: "minecraft", privateKeyPath: "C:/keys/id_ed25519" };

const LATEST: LatestVersions = {
  dailyBuild: { tag: "daily-2026-09-20+747", publishedAt: "2026-09-20T09:03:12Z" },
  modpack: { tag: "2.9.0-nightly-2026-09-20", publishedAt: "2026-09-20T00:27:16Z" },
};

const ENTRIES: RemoteDirectoryEntry[] = ["gtnh-2.8.4", "gtnh-2.9.0", "backups"].map((name) => ({ name, path: `/srv/${name}`, type: "directory", size: 4096 }));

/** Shows the remote paths panel with a stubbed bridge (app with ?fixture=remote-paths). */
export function RemotePathsFixture(): React.JSX.Element {
  const [paths, setPaths] = useState({ oldServerPath: "/srv/gtnh-2.8.4", newServerPath: "/srv/gtnh-2.9.0" });
  if (typeof window.gtnh !== "object") {
    window.gtnh = {
      invoke: (async (channel: string) => (channel === "releases:latest" ? LATEST : channel === "remote:list" ? ENTRIES : null)),
      on: () => () => undefined,
    } as Window["gtnh"];
  }
  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <RemotePathsPanel connection={CONNECTION} {...paths} locked={false} onChange={setPaths} />
    </Container>
  );
}
