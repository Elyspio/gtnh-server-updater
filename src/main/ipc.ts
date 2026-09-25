import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { INVOKE_CHANNELS, type InvokeChannel } from "@shared/ipc.channels";
import { ipcArguments, type IpcHandlers } from "@shared/ipc.contract";
import { log } from "./logger";

/**
 * Registers every contract channel. Calls from any other frame than the trusted window are
 * refused, and arguments are parsed with the shared schemas before reaching a handler.
 */
export function registerIpcHandlers(handlers: IpcHandlers, isTrustedSender: (event: IpcMainInvokeEvent) => boolean): void {
	for (const channel of INVOKE_CHANNELS) {
		ipcMain.handle(channel, async (event, ...rawArguments: unknown[]) => {
			if (!isTrustedSender(event)) {
				log("error", `Refused IPC call ${channel} from an untrusted frame`);
				throw new Error("Refused: untrusted sender");
			}
			const parsed = ipcArguments[channel].safeParse(rawArguments);
			if (!parsed.success) {
				const detail = parsed.error.issues.map((issue) => `${issue.path.join(".") || "arguments"}: ${issue.message}`).join("; ");
				log("error", `Invalid IPC arguments for ${channel}: ${detail}`);
				throw new Error(`Invalid request: ${detail}`);
			}
			return await invoke(handlers, channel, parsed.data);
		});
	}
}

async function invoke<C extends InvokeChannel>(handlers: IpcHandlers, channel: C, args: unknown): Promise<unknown> {
	const handler = handlers[channel] as (...values: unknown[]) => unknown;
	return await handler(...(args as unknown[]));
}
