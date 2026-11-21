import { useState } from "react";
import { Alert, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from "@mui/material";
import type { MergeDocument, MergeFileEntry } from "@shared/merge.types";
import { CONFLICT_START, KIND_LABELS, hasConflictMarkers } from "@shared/merge-model";
import { ThreeWayMergeEditor } from "./MonacoPanes";

type Props = {
	file: MergeFileEntry;
	document?: MergeDocument;
	busy: boolean;
	onClose(): void;
	onDecide(action: "keep-new" | "take-old"): void;
	onWrite(lines: string[]): void;
};

/** Review with the VS Code editor: your version, the result to write and the new version side by side. */
export function MergeReviewDialog({ file, document, busy, onClose, onDecide, onWrite }: Props): React.JSX.Element {
	const text = document?.contentKind === "text" ? document : undefined;
	const merged = text?.merged ?? "";
	const [result, setResult] = useState(merged);
	const [resultFor, setResultFor] = useState(merged);

	if (resultFor !== merged) {
		setResultFor(merged);
		setResult(merged);
	}

	const unresolved = hasConflictMarkers(result);

	return (
		<Dialog open fullScreen onClose={onClose}>
			<DialogTitle sx={{ pb: 1 }}>
				<Stack
					direction="row"
					spacing={2}
					sx={{
						alignItems: "center",
					}}
				>
					<Typography className="path-code" sx={{ flex: 1, wordBreak: "break-all" }}>
						{file.path}
					</Typography>
					<Chip size="small" label={KIND_LABELS[file.kind]} />
					{text && text.conflictCount > 0 && <Chip size="small" color="warning" label={`${text.conflictCount} conflicts`} />}
				</Stack>
			</DialogTitle>
			<DialogContent dividers className="review-content">
				{document && document.contentKind !== "text" && (
					<Alert severity="info">
						{describeWholeFile(document.contentKind)} Old: {document.oldSize} bytes, new: {document.newSize} bytes.
					</Alert>
				)}
				{!document && (
					<Typography
						sx={{
							color: "text.secondary",
						}}
					>
						Loading…
					</Typography>
				)}
				{text && (
					<Stack spacing={1} sx={{ height: "100%" }}>
						{unresolved && (
							<Alert severity="warning" sx={{ py: 0 }}>
								Conflict markers are still there ({CONFLICT_START}). Use » or « on a side, or keep the lines you want and delete the markers.
							</Alert>
						)}
						<ThreeWayMergeEditor oldText={text.old} newText={text.new} value={result} path={file.path} onChange={setResult} />
					</Stack>
				)}
			</DialogContent>
			<DialogActions>
				<Button onClick={onClose}>Close</Button>
				<Button disabled={busy} onClick={() => onDecide("keep-new")}>
					Keep new version
				</Button>
				<Button disabled={busy} onClick={() => onDecide("take-old")}>
					Take your whole file
				</Button>
				{text && (
					<Button variant="contained" disabled={busy || unresolved} onClick={() => onWrite(result.split("\n"))}>
						Use this result
					</Button>
				)}
			</DialogActions>
		</Dialog>
	);
}

function describeWholeFile(kind: Exclude<MergeDocument["contentKind"], "text">): string {
	if (kind === "binary") return "Binary file: choose the whole file.";
	if (kind === "large") return "File larger than 2 MiB: choose the whole file.";
	return "File is not valid UTF-8 text: choose the whole file.";
}
