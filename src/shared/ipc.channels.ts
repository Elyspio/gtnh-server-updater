/**
 * Channel names only, without dependencies: the sandboxed preload imports this file to
 * refuse any channel outside the contract before it reaches the main process.
 */
export const INVOKE_CHANNELS = [
	"dialog:archive",
	"dialog:private-key",
	"profiles:list",
	"profiles:save",
	"profiles:delete",
	"ssh:test",
	"ssh:trust-host",
	"ssh:kill-orphan",
	"releases:list",
	"releases:latest",
	"remote:list",
	"remote:mkdir",
	"deployment:preflight",
	"deployment:execute",
	"merge:prepare",
	"merge:load-file",
	"merge:apply",
	"merge:discard",
	"migration:prepare",
	"migration:execute",
	"operation:cancel",
	"app:open-logs",
	"report:save",
	"update:install",
] as const;

export const EVENT_CHANNELS = ["deployment:progress", "merge:progress", "migration:progress", "update:status"] as const;

export type InvokeChannel = (typeof INVOKE_CHANNELS)[number];
export type EventChannel = (typeof EVENT_CHANNELS)[number];
