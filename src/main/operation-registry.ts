import { log } from "./logger";

type RunningOperation = { name: string; controller: AbortController; done: Promise<unknown> };

/** Allows one remote operation at a time and lets the user or the window close cancel it. */
export class OperationRegistry {
  private current?: RunningOperation;

  public get running(): boolean {
    return this.current !== undefined;
  }

  public async run<T>(name: string, action: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.current) throw new Error(`Another operation is running (${this.current.name}); cancel it or wait for it to finish`);
    const controller = new AbortController();
    const done = action(controller.signal);
    this.current = { name, controller, done };
    log("info", `Operation started: ${name}`);
    try {
      return await done;
    } finally {
      log("info", `Operation finished: ${name}${controller.signal.aborted ? " (cancelled)" : ""}`);
      this.current = undefined;
    }
  }

  public cancel(): boolean {
    if (!this.current) return false;
    log("info", `Cancellation requested: ${this.current.name}`);
    this.current.controller.abort();
    return true;
  }

  /** Resolves once no operation runs, or after the timeout. */
  public async waitIdle(timeoutMs: number): Promise<void> {
    const current = this.current;
    if (!current) return;
    await Promise.race([
      current.done.catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  }
}
