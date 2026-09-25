import { describe, expect, it } from "vitest";
import { OperationRegistry } from "./operation-registry";

describe("operation registry", () => {
  it("runs one operation at a time", async () => {
    const registry = new OperationRegistry();
    let release: () => void = () => undefined;
    const first = registry.run("first", async () => await new Promise<void>((resolve) => { release = resolve; }));
    expect(registry.running).toBe(true);
    await expect(registry.run("second", async () => undefined)).rejects.toThrow("Another operation is running (first)");
    release();
    await first;
    expect(registry.running).toBe(false);
    await expect(registry.run("second", async () => "ok")).resolves.toBe("ok");
  });

  it("aborts the running operation on cancel", async () => {
    const registry = new OperationRegistry();
    const operation = registry.run("copy", async (signal) => await new Promise<string>((resolve) => {
      signal.addEventListener("abort", () => resolve("aborted"));
    }));
    expect(registry.cancel()).toBe(true);
    await expect(operation).resolves.toBe("aborted");
    expect(registry.cancel()).toBe(false);
  });
});
