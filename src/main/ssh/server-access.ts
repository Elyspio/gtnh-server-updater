import { quoteShell } from "./remote-client";

/** Preserve ownership as well as mode when replacing a file through an SSH-owned temporary. */
export function preserveAccessScript(reference: string, target: string): string {
	return [
		`if [ "$(stat -c '%u:%g' -- ${quoteShell(reference)})" != "$(stat -c '%u:%g' -- ${quoteShell(target)})" ]; then`,
		`  chown --reference=${quoteShell(reference)} -- ${quoteShell(target)}`,
		"fi",
		`chmod --reference=${quoteShell(reference)} -- ${quoteShell(target)}`,
	].join("\n");
}

/**
 * Existing paths keep their old owner, group and mode. New paths inherit the nearest
 * old directory's access; new regular files keep only executable bits allowed there.
 * Walk children first so changing a directory's access cannot block its descendants.
 */
export function alignServerAccessScript(oldServerPath: string, newServerPath: string): string {
	const worker = [
		"set -eu",
		"old=$1; new=$2; shift 2",
		// Never use a reference through a symlink, even when its target is inside the old tree.
		"safe_reference() {",
		"  probe=$1",
		'  while [ "$probe" != "$old" ]; do',
		'    [ ! -L "$probe" ] || return 1',
		"    probe=${probe%/*}",
		"  done",
		"}",
		"for target do",
		'  relative=${target#"$new"}; reference=$old$relative',
		"  exact=false",
		'  if safe_reference "$reference" && { { [ -d "$target" ] && [ -d "$reference" ]; } || { [ -f "$target" ] && [ -f "$reference" ]; }; }; then',
		"    exact=true",
		"  else",
		'    while ! safe_reference "$reference" || [ ! -d "$reference" ]; do',
		'      [ "$reference" != "$old" ] || { echo "Old server directory disappeared" >&2; exit 1; }',
		"      reference=${reference%/*}",
		"    done",
		"  fi",
		// chown may clear executable special bits, so compute the mode before changing ownership.
		'  if [ "$exact" = false ] && [ -f "$target" ]; then',
		'    directory_mode=$(stat -c %a -- "$reference")',
		'    archive_mode=$(stat -c %a -- "$target")',
		'    mode=$(printf "%o" "$(( (0$directory_mode & 0666) | (0$directory_mode & 0$archive_mode & 0111) ))")',
		"  fi",
		'  if [ "$(stat -c "%u:%g" -- "$reference")" != "$(stat -c "%u:%g" -- "$target")" ]; then',
		'    chown --reference="$reference" -- "$target"',
		"  fi",
		'  if [ "$exact" = true ] || [ -d "$target" ]; then',
		'    chmod --reference="$reference" -- "$target"',
		"  else",
		'    chmod "$mode" -- "$target"',
		"  fi",
		"done",
	].join("\n");
	return `find ${quoteShell(newServerPath)} -depth \\( -type d -o -type f \\) -exec sh -c ${quoteShell(worker)} sh ${quoteShell(oldServerPath)} ${quoteShell(newServerPath)} {} +`;
}
