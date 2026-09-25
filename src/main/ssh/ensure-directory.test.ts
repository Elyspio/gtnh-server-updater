import { describe, expect, it } from "vitest";
import type { CommandResult, RemoteClient } from "./remote-client";
import { ensureDirectory } from "./remote-operations";

/** Answers the handful of shell probes `ensureDirectory` runs, against a set of directories. */
class FakeClient {
  public readonly commands: string[] = [];

  public constructor(private readonly directories: Set<string>) {}

  public async execute(script: string): Promise<CommandResult> {
    this.commands.push(script);
    const [first = ""] = [...script.matchAll(/'([^']+)'/g)].map((match) => match[1]!);
    if (script.startsWith("mkdir --")) {
      this.directories.add(first);
      return { stdout: "", stderr: "", exitCode: 0 };
    }
    const exists = this.directories.has(first);
    if (!exists) return { stdout: "", stderr: `sh: 1: cd: can't cd to ${first}`, exitCode: 1 };
    return { stdout: script.includes("pwd -P") ? `${first}\n` : "", stderr: "", exitCode: 0 };
  }

  public async executeChecked(script: string): Promise<string> {
    const result = await this.execute(script);
    if (result.exitCode !== 0) throw new Error(`Remote command failed: ${result.stderr}`);
    return result.stdout;
  }
}

const clientOf = (...directories: string[]): FakeClient => new FakeClient(new Set(directories));
const asRemote = (client: FakeClient): RemoteClient => client as unknown as RemoteClient;

describe("ensureDirectory", () => {
  it("creates the directory when the deployment step left it missing", async () => {
    const client = clientOf("/data/gtnh");

    expect(await ensureDirectory(asRemote(client), "/data/gtnh/daily-747", "New server path")).toBe("/data/gtnh/daily-747");
    expect(client.commands.filter((command) => command.startsWith("mkdir --"))).toEqual(["mkdir -- '/data/gtnh/daily-747'"]);
  });

  it("keeps an existing directory untouched", async () => {
    const client = clientOf("/data/gtnh", "/data/gtnh/daily-747");

    expect(await ensureDirectory(asRemote(client), "/data/gtnh/daily-747/", "New server path")).toBe("/data/gtnh/daily-747");
    expect(client.commands.some((command) => command.startsWith("mkdir"))).toBe(false);
  });

  it("refuses to create a tree when the parent itself is missing", async () => {
    const client = clientOf("/data");

    await expect(ensureDirectory(asRemote(client), "/data/gtnh/daily-747", "New server path"))
      .rejects.toThrow("New server path does not exist and /data/gtnh is not a writable directory");
    expect(client.commands.some((command) => command.startsWith("mkdir"))).toBe(false);
  });

  it("rejects a path that is not absolute", async () => {
    const client = clientOf("/data/gtnh");

    await expect(ensureDirectory(asRemote(client), "data/gtnh/daily-747", "New server path")).rejects.toThrow();
    expect(client.commands).toEqual([]);
  });
});
