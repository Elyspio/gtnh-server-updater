# GTNH Server Updater

Electron application for preparing a new GTNH server directory on a remote Linux host over SSH.

The first implemented slice provides:

- SSH private-key authentication;
- remote directory browsing and absolute path entry;
- local ZIP upload over SFTP or server-side HTTPS download;
- strict path, archive, tool, permission and disk-space preflight;
- destructive destination confirmation by exact resolved path;
- direct extraction with partial files preserved and reported after failure.

Configuration merging and world migration remain tracked in the [Wayfinder map](.scratch/gtnh-server-updater/map.md).

## Development

Requirements: Node.js 20+, pnpm 10, and a Linux target with a POSIX shell, `curl` and `unzip`.

```bash
pnpm install
pnpm dev
```

Validation commands:

```bash
pnpm typecheck
pnpm test
pnpm build
```

The app does not use `sudo`. A deployment never writes to the old server path. SSH host-key verification and resumable operations are intentionally assigned to the next connection/recovery design ticket.

## Design documents

- [Wayfinder map](.scratch/gtnh-server-updater/map.md)
- [Agreed scope and validation](.scratch/gtnh-server-updater/spec.md)
- [Local tracker convention](.scratch/gtnh-server-updater/tracker.md)
