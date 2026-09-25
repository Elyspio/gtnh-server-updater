import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { Box, IconButton, Stack, Tooltip, Typography } from "@mui/material";
import { KeyboardArrowDownRounded, KeyboardArrowUpRounded } from "@mui/icons-material";
import { alignmentFillers, findConflicts, navigationTargets, replaceLines, sideHunks, type Filler, type Hunk } from "@shared/merge-review";
import { languageOf, monaco } from "./monaco";

const BASE_OPTIONS: monaco.editor.IStandaloneEditorConstructionOptions = {
	theme: "gtnh-dark",
	automaticLayout: true,
	minimap: { enabled: false },
	scrollBeyondLastLine: false,
	fontFamily: '"IBM Plex Mono", monospace',
	fontSize: 12,
	renderWhitespace: "selection",
	// A sticky header would hide lines that the other panes show level with them.
	stickyScroll: { enabled: false },
	// Wrapped lines would break the line-to-line alignment of the three panes.
	wordWrap: "off",
	glyphMargin: true,
};

type Side = "old" | "new";
type Editors = { old: monaco.editor.IStandaloneCodeEditor; result: monaco.editor.IStandaloneCodeEditor; new: monaco.editor.IStandaloneCodeEditor };
type Decorations = Record<keyof Editors, monaco.editor.IEditorDecorationsCollection>;

const SIDE_TITLES: Record<Side, string> = { old: "Your version", new: "New version" };

/** The arrow of a hunk sits on its first line, or on the line where the missing lines would go. */
function glyphLine(hunk: Hunk, lineCount: number): number {
	return Math.min(hunk.sideStart + 1, lineCount);
}

function sideDecorations(hunks: Hunk[], side: Side, lineCount: number): monaco.editor.IModelDeltaDecoration[] {
	const color = side === "old" ? "#86c06c" : "#64a0e6";
	return hunks.flatMap((hunk) => {
		const line = glyphLine(hunk, lineCount);
		const arrow: monaco.editor.IModelDeltaDecoration = {
			range: new monaco.Range(line, 1, line, 1),
			options: {
				glyphMarginClassName: `merge-take merge-take-${side}`,
				glyphMarginHoverMessage: { value: "Use this block in the result" },
				overviewRuler: { color, position: monaco.editor.OverviewRulerLane.Full },
			},
		};
		if (hunk.sideEnd > hunk.sideStart) {
			return [arrow, { range: new monaco.Range(hunk.sideStart + 1, 1, hunk.sideEnd, 1), options: { isWholeLine: true, className: `merge-line-${side}` } }];
		}
		const gap = hunk.sideStart < lineCount ? "merge-gap-before" : "merge-gap-after";
		return [arrow, { range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: `${gap} merge-gap-${side}` } }];
	});
}

function resultDecorations(result: string[], oldHunks: Hunk[], newHunks: Hunk[]): monaco.editor.IModelDeltaDecoration[] {
	const lines = (hunks: Hunk[], className: string): monaco.editor.IModelDeltaDecoration[] =>
		hunks
			.filter((hunk) => hunk.resultEnd > hunk.resultStart)
			.map((hunk) => ({ range: new monaco.Range(hunk.resultStart + 1, 1, hunk.resultEnd, 1), options: { isWholeLine: true, linesDecorationsClassName: className } }));
	const conflicts = findConflicts(result).map((conflict) => ({
		range: new monaco.Range(conflict.start + 1, 1, conflict.end + 1, 1),
		options: { isWholeLine: true, className: "merge-conflict", overviewRuler: { color: "#e4a44b", position: monaco.editor.OverviewRulerLane.Full } },
	}));
	return [...lines(oldHunks, "merge-result-old"), ...lines(newHunks, "merge-result-new"), ...conflicts];
}

// The fillers give the panes the same geometry: they simply share one scroll position.
function syncScroll(panes: Editors, source: keyof Editors): void {
	for (const target of ["old", "result", "new"] as const) {
		if (target === source) continue;
		panes[target].setScrollTop(panes[source].getScrollTop());
		panes[target].setScrollLeft(panes[source].getScrollLeft());
	}
}

/** Replaces the blank zones of a pane; returns the new zone ids. */
function showFillers(editor: monaco.editor.IStandaloneCodeEditor, previous: string[], fillers: Filler[]): string[] {
	const ids: string[] = [];
	editor.changeViewZones((accessor) => {
		previous.forEach((id) => accessor.removeZone(id));
		for (const filler of fillers) {
			const domNode = document.createElement("div");
			domNode.className = "merge-filler";
			ids.push(accessor.addZone({ afterLineNumber: filler.afterLine, heightInLines: filler.lines, domNode }));
		}
	});
	return ids;
}

type Props = { oldText: string; newText: string; value: string; path: string; onChange(next: string): void };

/**
 * Your version, the result (editable) and the new version side by side. The arrows of a side copy
 * its block into the result; the panes scroll together, aligned on matching lines.
 */
export function ThreeWayMergeEditor({ oldText, newText, value, path, onChange }: Props): React.JSX.Element {
	const oldHost = useRef<HTMLDivElement>(null);
	const resultHost = useRef<HTMLDivElement>(null);
	const newHost = useRef<HTMLDivElement>(null);
	const editors = useRef<Editors>(undefined);
	const decorations = useRef<Decorations>(undefined);
	const fillerZones = useRef<Record<keyof Editors, string[]>>({ old: [], result: [], new: [] });
	const [position, setPosition] = useState<{ kind: string; index: number }>({ kind: "conflict", index: -1 });

	const oldLines = useMemo(() => oldText.split("\n"), [oldText]);
	const newLines = useMemo(() => newText.split("\n"), [newText]);
	const resultLines = useMemo(() => value.split("\n"), [value]);
	const oldHunks = useMemo(() => sideHunks(oldLines, resultLines, "old"), [oldLines, resultLines]);
	const newHunks = useMemo(() => sideHunks(newLines, resultLines, "new"), [newLines, resultLines]);
	const targets = useMemo(() => navigationTargets(resultLines, oldHunks, newHunks), [resultLines, oldHunks, newHunks]);
	const current = position.kind === targets.kind && position.index < targets.ranges.length ? position.index : -1;

	const initialValue = useEffectEvent(() => value);
	const emitChange = useEffectEvent(onChange);

	const takeHunk = useEffectEvent((side: Side, line: number) => {
		const panes = editors.current;
		const model = panes?.result.getModel();
		if (!panes || !model) return;
		const lineCount = panes[side].getModel()?.getLineCount() ?? 1;
		const hunk = (side === "old" ? oldHunks : newHunks).find((candidate) => glyphLine(candidate, lineCount) === line);
		if (!hunk) return;
		const lines = (side === "old" ? oldLines : newLines).slice(hunk.sideStart, hunk.sideEnd);
		const edit = replaceLines(model.getValue(), hunk.resultStart, hunk.resultEnd, lines);
		const start = model.getPositionAt(edit.start);
		const end = model.getPositionAt(edit.end);
		panes.result.pushUndoStop();
		panes.result.executeEdits("merge-take", [{ range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column), text: edit.text, forceMoveMarkers: true }]);
		panes.result.pushUndoStop();
	});

	const navigate = (step: 1 | -1): void => {
		const count = targets.ranges.length;
		const panes = editors.current;
		if (count === 0 || !panes) return;
		const index = current < 0 ? (step > 0 ? 0 : count - 1) : (current + step + count) % count;
		setPosition({ kind: targets.kind, index });
		const lineCount = panes.result.getModel()?.getLineCount() ?? 1;
		const line = Math.min(targets.ranges[index].start + 1, lineCount);
		panes.result.revealLineInCenter(line);
		panes.result.setPosition({ lineNumber: line, column: 1 });
		panes.result.focus();
	};
	const navigateFromKeyboard = useEffectEvent(navigate);

	useEffect(() => {
		if (!oldHost.current || !resultHost.current || !newHost.current) return undefined;
		const language = languageOf(path);
		const models = {
			old: monaco.editor.createModel(oldText, language),
			result: monaco.editor.createModel(initialValue(), language),
			new: monaco.editor.createModel(newText, language),
		};
		const panes: Editors = {
			old: monaco.editor.create(oldHost.current, { ...BASE_OPTIONS, model: models.old, readOnly: true }),
			result: monaco.editor.create(resultHost.current, { ...BASE_OPTIONS, model: models.result, glyphMargin: false }),
			new: monaco.editor.create(newHost.current, { ...BASE_OPTIONS, model: models.new, readOnly: true }),
		};
		editors.current = panes;
		decorations.current = { old: panes.old.createDecorationsCollection(), result: panes.result.createDecorationsCollection(), new: panes.new.createDecorationsCollection() };

		let syncing = false;
		const subscriptions = [
			models.result.onDidChangeContent(() => emitChange(models.result.getValue())),
			...(["old", "new"] as const).map((side) =>
				panes[side].onMouseDown((event) => {
					if (event.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN && event.target.position) takeHunk(side, event.target.position.lineNumber);
				})
			),
			...(["old", "result", "new"] as const).map((source) =>
				panes[source].onDidScrollChange((event) => {
					if (syncing || !(event.scrollTopChanged || event.scrollLeftChanged)) return;
					syncing = true;
					try {
						syncScroll(panes, source);
					} finally {
						syncing = false;
					}
				})
			),
		];
		return () => {
			subscriptions.forEach((subscription) => subscription.dispose());
			Object.values(panes).forEach((editor) => editor.dispose());
			Object.values(models).forEach((model) => model.dispose());
			editors.current = undefined;
			fillerZones.current = { old: [], result: [], new: [] };
			decorations.current = undefined;
		};
	}, [oldText, newText, path]);

	// The result is only replaced from outside when the reviewed document changes.
	useEffect(() => {
		const model = editors.current?.result.getModel();
		if (model && model.getValue() !== value) model.pushEditOperations([], [{ range: model.getFullModelRange(), text: value }], () => null);
	}, [value]);

	useEffect(() => {
		const panes = editors.current;
		if (!panes || !decorations.current) return;
		decorations.current.old.set(sideDecorations(oldHunks, "old", panes.old.getModel()?.getLineCount() ?? 1));
		decorations.current.new.set(sideDecorations(newHunks, "new", panes.new.getModel()?.getLineCount() ?? 1));
		decorations.current.result.set(resultDecorations(resultLines, oldHunks, newHunks));
		const fillers = alignmentFillers(oldHunks, newHunks);
		for (const pane of ["old", "result", "new"] as const) fillerZones.current[pane] = showFillers(panes[pane], fillerZones.current[pane], fillers[pane]);
	}, [oldHunks, newHunks, resultLines, oldText, newText, path]);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key !== "F7") return;
			event.preventDefault();
			navigateFromKeyboard(event.shiftKey ? -1 : 1);
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);

	const noun = targets.kind === "conflict" ? "Conflict" : "Difference";
	const count = targets.ranges.length;
	const label = count === 0 ? "No difference" : current < 0 ? `${count} ${noun.toLowerCase()}${count > 1 ? "s" : ""}` : `${noun} ${current + 1}/${count}`;

	return (
		<Stack direction="row" spacing={1} className="merge-panes">
			<SidePane side="old" host={oldHost} />
			<Box className="editor-pane">
				<Stack direction="row" className="editor-pane-title merge-result-title" sx={{ alignItems: "center", borderColor: "#e4a44b" }}>
					<Typography variant="caption" sx={{ flex: 1 }}>
						Result to write
					</Typography>
					<Typography variant="caption" sx={{ color: "text.secondary", mr: 0.5 }}>
						{label}
					</Typography>
					<Tooltip title="Previous (Shift+F7)">
						<span>
							<IconButton size="small" aria-label="Previous" disabled={count === 0} onClick={() => navigate(-1)}>
								<KeyboardArrowUpRounded fontSize="small" />
							</IconButton>
						</span>
					</Tooltip>
					<Tooltip title="Next (F7)">
						<span>
							<IconButton size="small" aria-label="Next" disabled={count === 0} onClick={() => navigate(1)}>
								<KeyboardArrowDownRounded fontSize="small" />
							</IconButton>
						</span>
					</Tooltip>
				</Stack>
				<Box ref={resultHost} className="editor-surface" />
			</Box>
			<SidePane side="new" host={newHost} />
		</Stack>
	);
}

function SidePane({ side, host }: { side: Side; host: React.RefObject<HTMLDivElement | null> }): React.JSX.Element {
	return (
		<Box className="editor-pane">
			<Typography variant="caption" className="editor-pane-title" sx={{ borderColor: side === "old" ? "#86c06c" : "#64a0e6" }}>
				{SIDE_TITLES[side]}
			</Typography>
			<Box ref={host} className="editor-surface" />
		</Box>
	);
}
