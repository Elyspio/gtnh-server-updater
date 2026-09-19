import { readFile } from "node:fs/promises";
import { Client, type ConnectConfig, type SFTPWrapper } from "ssh2";
import type { RemoteDirectoryEntry, SshConnectionInput } from "@shared/deployment.types";

export type CommandResult = { stdout: string; stderr: string; exitCode: number | null };

export class RemoteClient {
  private readonly client = new Client();
  private sftp?: SFTPWrapper;

  public constructor(private readonly input: SshConnectionInput) {}

  public async connect(): Promise<void> {
    const privateKey = await readFile(this.input.privateKeyPath);
    const config: ConnectConfig = {
      host: this.input.host,
      port: this.input.port,
      username: this.input.username,
      privateKey,
      passphrase: this.input.passphrase || undefined,
      readyTimeout: 20_000,
      keepaliveInterval: 10_000,
      keepaliveCountMax: 3,
    };

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
  }

  public close(): void {
    this.client.end();
  }

  public async execute(script: string): Promise<CommandResult> {
    const command = `sh -lc ${quoteShell(script)}`;
    return await new Promise<CommandResult>((resolve, reject) => {
      this.client.exec(command, (error, channel) => {
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
        channel.once("close", (exitCode: number | null) => resolve({ stdout, stderr, exitCode }));
      });
    });
  }

  public async executeChecked(script: string): Promise<string> {
    const result = await this.execute(script);
    if (result.exitCode !== 0) {
      const details = result.stderr.trim() || result.stdout.trim() || `exit code ${String(result.exitCode)}`;
      throw new Error(`Remote command failed: ${details}`);
    }
    return result.stdout;
  }

  public async upload(
    localPath: string,
    remotePath: string,
    onProgress: (transferred: number, total: number) => void,
  ): Promise<void> {
    const sftp = await this.getSftp();
    await new Promise<void>((resolve, reject) => {
      sftp.fastPut(localPath, remotePath, {
        step: (transferred, _chunk, total) => onProgress(transferred, total),
      }, (error) => error ? reject(error) : resolve());
    });
  }

  public async listDirectory(remotePath: string): Promise<RemoteDirectoryEntry[]> {
    const sftp = await this.getSftp();
    return await new Promise<RemoteDirectoryEntry[]>((resolve, reject) => {
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
    });
  }

  private async getSftp(): Promise<SFTPWrapper> {
    if (this.sftp) return this.sftp;
    this.sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
      this.client.sftp((error, sftp) => error ? reject(error) : resolve(sftp));
    });
    return this.sftp;
  }
}

export function quoteShell(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function joinRemotePath(parent: string, name: string): string {
  return `${parent.replace(/\/$/, "")}/${name}`;
}
