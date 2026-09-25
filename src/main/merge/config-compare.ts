/**
 * Mods rewrite their configuration at every server start: they add options with their default
 * value, reword comments, reindent and reorder entries. Comparing bytes therefore reports
 * hundreds of "user changes". These parsers compare known formats key by key instead, so only a
 * value the user actually changed on an existing key counts as a change.
 */

export type ConfigComparison = "changed" | "regenerated" | "unknown-format";

/** Bumped by mod updates, never by the user. */
const VERSION_KEYS = /^~?(config[_-]?version|version)$/i;

export function compareConfigs(path: string, base: string, current: string): ConfigComparison {
  const parse = parserFor(path);
  if (!parse) return "unknown-format";
  let baseEntries: Map<string, string>;
  let currentEntries: Map<string, string>;
  try {
    baseEntries = parse(base);
    currentEntries = parse(current);
  } catch {
    return "unknown-format";
  }
  if (baseEntries.size === 0 && currentEntries.size === 0) return "unknown-format";

  for (const [key, value] of currentEntries) {
    if (!baseEntries.has(key)) continue;
    if (baseEntries.get(key) === value) continue;
    if (VERSION_KEYS.test(key.slice(key.lastIndexOf("/") + 1))) continue;
    return "changed";
  }
  return "regenerated";
}

function parserFor(path: string): ((text: string) => Map<string, string>) | undefined {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  if (name.endsWith(".cfg") || name.endsWith(".conf")) return parseForgeConfig;
  if (name.endsWith(".properties") || name.endsWith(".ini")) return parseProperties;
  if (name.endsWith(".json")) return parseJson;
  return undefined;
}

/**
 * Forge configuration: nested `section {` blocks, `T:key=value` entries and
 * `T:key <` … `>` list blocks. Comments, blank lines, indentation and order are ignored.
 */
export function parseForgeConfig(text: string): Map<string, string> {
  const entries = new Map<string, string>();
  const sections: string[] = [];
  const lines = text.split(/\r?\n/);
  let listKey: string | undefined;
  let listValues: string[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (listKey !== undefined) {
      if (line === ">") {
        entries.set(listKey, [...listValues].sort().join("\n"));
        listKey = undefined;
        listValues = [];
      } else if (line && !line.startsWith("#")) {
        listValues.push(line);
      }
      continue;
    }
    if (!line || line.startsWith("#")) continue;
    if (line === "}") {
      sections.pop();
      continue;
    }

    const list = /^(?:([A-Za-z]):)?"?(.+?)"?\s*<$/.exec(line);
    if (list && !line.includes("=")) {
      listKey = qualify(sections, list[2]!);
      continue;
    }
    const entry = /^(?:([A-Za-z]):)?"?(.+?)"?\s*=\s*(.*)$/.exec(line);
    if (entry) {
      entries.set(qualify(sections, entry[2]!), entry[3]!.trim());
      continue;
    }
    const section = /^"?(.+?)"?\s*\{$/.exec(line);
    if (section) sections.push(section[1]!.trim());
  }
  if (listKey !== undefined) throw new Error("Unterminated list block");
  return entries;
}

/** `key=value` or `key:value` lines, `#` and `!` comments (server.properties, *.ini). */
export function parseProperties(text: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("!") || line.startsWith("[")) continue;
    const match = /^([^=:]+)[=:](.*)$/.exec(line);
    if (match) entries.set(match[1]!.trim(), match[2]!.trim());
  }
  return entries;
}

/** Flattened JSON: key order and formatting are ignored, values are compared per path. */
export function parseJson(text: string): Map<string, string> {
  const entries = new Map<string, string>();
  flatten(JSON.parse(text) as unknown, "", entries);
  return entries;
}

function flatten(value: unknown, prefix: string, entries: Map<string, string>): void {
  if (Array.isArray(value)) {
    // Player lists and similar arrays are order-insensitive.
    entries.set(prefix || "/", [...value].map((item) => JSON.stringify(item)).sort().join("\n"));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) flatten(nested, `${prefix}/${key}`, entries);
    return;
  }
  entries.set(prefix || "/", JSON.stringify(value));
}

function qualify(sections: string[], key: string): string {
  return [...sections, key.trim()].join("/");
}
