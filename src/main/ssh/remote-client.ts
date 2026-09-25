import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Client, type ConnectConfig, type SFTPWrapper } from "ssh2";
import type { HostKeyCheck, RemoteOrphan } from "@shared/connection.types";
import type { RemoteDirectoryEntry, SshConnectionInput } from "@shared/deployment.types";
import { log } from "../logger";
import { getHostKeyStore } from "./host-key-store";
import { preparePrivateKey } from "./private-key";

export type CommandResult = { stdout: string; stderr: string; exitCode: number | null };

export const PID_DIRECTORY = "$HOME/.gtnh-updater/pids";
const PID_MARKER = "GTNH_UPDATER_PID=";

export class RemoteClient {
  private readonly client = new Client();
  private sftp?: SFTPWrapper;
  private lost = false;
  /** Rejects once the connection is gone, so SFTP calls never wait forever after a cancel or loss. */
  private readonly closed: Promise<never>;
  private rejectClosed: (error: Error) => void = () => undefined;
  /** Result of the host key check made during the last connection attempt. */
  public hostKeyCheck?: HostKeyCheck;

  public constructor(private readonly input: SshConnectionInput) {
    this.closed = new Promise<never>((_resolve, reject) => { this.rejectClosed = reject; });
    this.closed.catch(() => undefined);
  }

  /**
   * Connects after verifying the host key. With `hostKeyOnly`, stops right after the key
   * exchange (the key is recorded for an explicit trust decision) and never authenticates.
   */
  public async connect(options: { hostKeyOnly?: boolean } = {}): Promise<void> {
    let key: ReturnType<typeof preparePrivateKey> | undefined;
    if (!options.hostKeyOnly) {
      try {
        key = preparePrivateKey(await readFile(this.input.privateKeyPath), this.input.passphrase);
      } catch (error) {
        throw new Error(`The private key could not be read: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const config: ConnectConfig = {
      host: this.input.host,
      port: this.input.port,
      username: this.input.username,
      ...key,
      readyTimeout: 20_000,
      keepaliveInterval: 10_000,
      keepaliveCountMax: 3,
      hostVerifier: (keyBlob: Buffer) => {
        this.hostKeyCheck = getHostKeyStore().check(this.input.host, this.input.port, keyBlob);
        return this.hostKeyCheck.status === "known" && !options.hostKeyOnly;
      },
    };

    log("info", `Connecting to ${this.input.username}@${this.input.host}:${this.input.port}`);
    try {
      await new Promise<void>((resolve, reject) => {
        const onReady = (): void => {
          cleanup();
          resolve();
        };
        const onError = (error: Error): void => {
          cleanup();
          reject(error);
        };
        const cleanup = (): void => {
          this.client.off("ready", onReady);
          this.client.off("error", onError);
        };
        this.client.once("ready", onReady);
        this.client.once("error", onError);
        this.client.connect(config);
      });
    } catch (error) {
      const friendly = this.describeConnectionError(error);
      log("error", `Connection failed: ${friendly}`);
      throw new Error(friendly);
    }
    this.client.on("error", (error) => {
      this.lost = true;
      log("error", `SSH connection error: ${error.message}`);
    });
    this.client.on("close", () => this.markLost());
  }

  public close(): void {
    this.client.end();
  }

  /** Tears the connection down immediately; remote tracked commands are terminated by their watchdog. */
  public destroy(): void {
    this.markLost();
    this.client.destroy();
  }

  private markLost(): void {
    this.lost = true;
    this.rejectClosed(new Error("SSH connection lost"));
  }

  /** SFTP callbacks are not guaranteed to fire when the connection drops. */
  private async guard<T>(operation: Promise<T>): Promise<T> {
    if (this.lost) throw new Error("SSH connection lost");
    return await Promise.race([operation, this.closed]);
  }

  public async execute(script: string): Promise<CommandResult> {
    return await this.run(script, script);
  }

  /**
   * Runs a long command in its own process group with its PID recorded on the server.
   * If the SSH channel closes (cancel or connection loss), a watchdog reading the channel's
   * stdin kills the whole group.
   */
  public async executeTracked(script: string): Promise<CommandResult> {
    const result = await this.run(buildTrackedScript(script, randomUUID()), script);
    return { ...result, stderr: result.stderr.split("\n").filter((line) => !line.startsWith(PID_MARKER)).join("\n") };
  }

  private async run(command: string, logged: string): Promise<CommandResult> {
    if (this.lost) throw new Error("SSH connection lost");
    const started = Date.now();
    const result = await this.guard(new Promise<CommandResult>((resolve, reject) => {
      this.client.exec(`sh -lc ${quoteShell(command)}`, (error, channel) => {
        if (error) {
          reject(error);
          return;
        }
        let stdout = "";
        let stderr = "";
        channel.setEncoding("utf8");
        channel.on("data", (chunk: string) => { stdout += chunk; });
        channel.stderr.setEncoding("utf8");
        channel.stderr.on("data", (chunk: string) => { stderr += chunk; });
        channel.once("error", reject);
        channel.once("close", (exitCode: number | null | undefined) => resolve({ stdout, stderr, exitCode: exitCode ?? null }));
      });
    }));
    log(result.exitCode === 0 ? "info" : "error", `exit=${String(result.exitCode)} ${Date.now() - started}ms ${summarizeCommand(logged)}${result.exitCode === 0 ? "" : ` stderr=${result.stderr.trim().slice(0, 500)}`}`);
    if (result.exitCode === null && this.lost) throw new Error("SSH connection lost");
    return result;
  }

  private describeConnectionError(error: unknown): string {
    const failure = error as Error & { level?: string; code?: string };
    const check = this.hostKeyCheck;
    if (check && check.status === "mismatch") {
      return `The server identity changed for ${check.host}:${check.port} (${check.keyType} ${check.fingerprint}). Connection refused; update known_hosts yourself if this change is expected.`;
    }
    if (check && check.status === "unknown") {
      return `The server identity is not trusted yet (${check.keyType} ${check.fingerprint}). Use Test connection to review and trust it.`;
    }
    if (failure.level === "client-authentication") {
      return "Authentication failed: the server rejected the private key.";
    }
    if (failure.level === "client-timeout" || failure.level === "client-socket"
      || ["ENOTFOUND", "ECONNREFUSED", "ETIMEDOUT", "EHOSTUNREACH", "ECONNRESET"].includes(failure.code ?? "")) {
      return `Server unreachable: ${failure.message}`;
    }
    return failure.message ?? String(error);
  }

  public async executeChecked(script: string): Promise<string> {
    return checkResult(await this.execute(script));
  }

  public async executeTrackedChecked(script: string): Promise<string> {
    return checkResult(await this.executeTracked(script));
  }

  /** Lists process groups started by the app that are still alive; stale PID files are removed. */
  public async listOrphans(): Promise<RemoteOrphan[]> {
    const output = await this.executeChecked([
      `for file in "${PID_DIRECTORY}"/*.pid; do`,
      '  [ -f "$file" ] || continue',
      '  pid=$(cat "$file")',
      '  case "$pid" in ""|*[!0-9]*) rm -f "$file"; continue;; esac',
      '  if kill -0 "$pid" 2>/dev/null; then',
      `    printf '%s\\t%s\\t%s\\n' "$(basename "$file" .pid)" "$pid" "$(ps -o args= -p "$pid" 2>/dev/null | cut -c1-200)"`,
      '  else rm -f "$file"; fi',
      "done",
    ].join("\n"));
    return output.split("\n").filter(Boolean).map((line) => {
      const [id, pid, command] = line.split("\t");
      return { id: id ?? "", pid: Number(pid), command: command ?? "" };
    }).filter((orphan) => /^[0-9a-f-]{36}$/.test(orphan.id) && Number.isSafeInteger(orphan.pid) && orphan.pid > 1);
  }

  public async killOrphan(id: string, pid: number): Promise<void> {
    if (!/^[0-9a-f-]{36}$/.test(id) || !Number.isSafeInteger(pid) || pid <= 1) throw new Error("Invalid process");
    await this.executeChecked([
      `file="${PID_DIRECTORY}/${id}.pid"`,
      `[ "$(cat "$file" 2>/dev/null)" = "${pid}" ] || { echo "The process is no longer tracked" >&2; exit 1; }`,
      `kill -TERM -${pid} 2>/dev/null || kill -TERM ${pid} 2>/dev/null || true`,
      'rm -f "$file"',
    ].join("\n"));
  }

  public async upload(
    localPath: string,
    remotePath: string,
    onProgress: (transferred: number, total: number) => void,
  ): Promise<void> {
    const sftp = await this.getSftp();
    await this.guard(new Promise<void>((resolve, reject) => {
      sftp.fastPut(localPath, remotePath, {
        step: (transferred, _chunk, total) => onProgress(transferred, total),
      }, (error) => error ? reject(error) : resolve());
    }));
  }

  public async readFile(remotePath: string, maxBytes: number): Promise<{ size: number; content?: Buffer }> {
    const sftp = await this.getSftp();
    const size = await this.guard(new Promise<number>((resolve, reject) => {
      sftp.stat(remotePath, (error, attributes) => error ? reject(error) : resolve(attributes.size));
    }));
    if (size > maxBytes) return { size };
    const content = await this.guard(new Promise<Buffer>((resolve, reject) => {
      sftp.readFile(remotePath, (error, data) => error ? reject(error) : resolve(data));
    }));
    return { size, content };
  }

  public async writeFile(remotePath: string, content: Buffer): Promise<void> {
    const sftp = await this.getSftp();
    await this.guard(new Promise<void>((resolve, reject) => {
      sftp.writeFile(remotePath, content, (error) => error ? reject(error) : resolve());
    }));
  }

  public async listDirectory(remotePath: string): Promise<RemoteDirectoryEntry[]> {
    const sftp = await this.getSftp();
    return await this.guard(new Promise<RemoteDirectoryEntry[]>((resolve, reject) => {
      sftp.readdir(remotePath, (error, entries) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(entries
          .filter((entry) => entry.filename !== "." && entry.filename !== "..")
          .map((entry): RemoteDirectoryEntry => ({
            name: entry.filename,
            path: joinRemotePath(remotePath, entry.filename),
            type: entry.attrs.isDirectory()
              ? "directory"
              : entry.attrs.isSymbolicLink()
                ? "symlink"
                : entry.attrs.isFile() ? "file" : "other",
            size: entry.attrs.size,
          }))
          .sort((left, right) => {
            if (left.type === "directory" && right.type !== "directory") return -1;
            if (left.type !== "directory" && right.type === "directory") return 1;
            return left.name.localeCompare(right.name);
          }));
      });
    }));
  }

  private async getSftp(): Promise<SFTPWrapper> {
    if (this.sftp) return this.sftp;
    this.sftp = await this.guard(new Promise<SFTPWrapper>((resolve, reject) => {
      this.client.sftp((error, sftp) => error ? reject(error) : resolve(sftp));
    }));
    return this.sftp;
  }
}

export function buildTrackedScript(script: string, id: string): string {
  const pidFile = `${PID_DIRECTORY}/${id}.pid`;
  return [
    `mkdir -p "${PID_DIRECTORY}"`,
    "exec 3<&0",
    `setsid sh -c ${quoteShell(script)} 3<&- &`,
    "child=$!",
    `printf '%s\\n' "$child" > "${pidFile}"`,
    // sshd signals this shell when the connection drops: stop the group and forget its PID.
    `trap 'kill -TERM -"$child" 2>/dev/null; rm -f "${pidFile}"; exit 129' HUP INT TERM PIPE`,
    `printf '${PID_MARKER}%s\\n' "$child" >&2`,
    `{ cat >/dev/null; kill -TERM -"$child"; } <&3 >/dev/null 2>&1 &`,
    "watch=$!",
    "exec 3<&-",
    "wait \"$child\"",
    "status=$?",
    "kill \"$watch\" 2>/dev/null",
    `rm -f "${pidFile}"`,
    "exit \"$status\"",
  ].join("\n");
}

function checkResult(result: CommandResult): string {
  if (result.exitCode !== 0) {
    const details = result.stderr.trim() || result.stdout.trim() || `exit code ${String(result.exitCode)}`;
    throw new Error(`Remote command failed: ${details}`);
  }
  return result.stdout;
}

function summarizeCommand(script: string): string {
  const flat = script.replace(/\s+/g, " ").trim();
  return flat.length > 400 ? `${flat.slice(0, 400)}…` : flat;
}

export function quoteShell(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function joinRemotePath(parent: string, name: string): string {
  return `${parent.replace(/\/$/, "")}/${name}`;
}
