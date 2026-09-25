import { useState } from "react";
import { Container } from "@mui/material";
import type { SshProfileList } from "@shared/connection.types";
import type { SshConnectionInput } from "@shared/deployment.types";
import { ConnectionPanel } from "./ConnectionPanel";

const PROFILES: SshProfileList = {
  canStorePassphrase: true,
  profiles: [
    { id: "8f0d1b2c-0000-4000-8000-000000000001", name: "ely-minecraft", host: "ely-minecraft", port: 22, username: "root", privateKeyPath: "C:/Users/jonag/.ssh/id_ed25519", oldServerPath: "/data/gtnh/daily-731", newServerPath: "/data/gtnh/daily-747", hasStoredPassphrase: true },
    { id: "8f0d1b2c-0000-4000-8000-000000000002", name: "backup box", host: "10.0.0.59", port: 2222, username: "minecraft", privateKeyPath: "C:/Users/jonag/.ssh/id_rsa", oldServerPath: "/srv/old", newServerPath: "/srv/new", hasStoredPassphrase: false },
  ],
};

/** Shows the connection panel with a stubbed bridge (app with ?fixture=connection, &empty=1 for a first run). */
export function ConnectionFixture(): React.JSX.Element {
  const firstRun = new URLSearchParams(window.location.search).has("empty");
  const [connection, setConnection] = useState<SshConnectionInput>({ host: "", port: 22, username: "", privateKeyPath: "", passphrase: "" });
  if (typeof window.gtnh !== "object") {
    window.gtnh = {
      invoke: (async (channel: string) => {
        if (channel === "profiles:list") return firstRun ? { ...PROFILES, profiles: [] } : PROFILES;
        if (channel === "ssh:test") return { hostKey: { status: "known" }, authenticated: true, orphans: [] };
        return null;
      }),
      on: () => () => undefined,
    } as Window["gtnh"];
  }
  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <ConnectionPanel
        connection={connection}
        oldServerPath="/data/gtnh/daily-731"
        newServerPath="/data/gtnh/daily-747"
        locked={false}
        onConnectionChange={setConnection}
        onProfileLoaded={() => undefined}
        onTested={() => undefined}
      />
    </Container>
  );
}
