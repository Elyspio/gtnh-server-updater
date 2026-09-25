import { MergeReviewDialog } from "./MergeReviewDialog";
import { CONFLICT_END, CONFLICT_SEPARATOR, CONFLICT_START } from "@shared/merge-model";

const BASE = ["# GregTech", "general {", "    B:machineFireExplosions=true", "    I:pollutionSmogLimit=550000", "    B:enableAchievements=true", "}"];
const OLD = ["# GregTech", "general {", "    B:machineFireExplosions=false", "    I:pollutionSmogLimit=550000", "    B:enableAchievements=true", "}"];
const NEW = ["# GregTech", "general {", "    B:machineFireExplosions=true", "    I:pollutionSmogLimit=400000", "    B:enableAchievements=false", "    B:newOption=true", "}"];

/** Shows the review window with a small conflict (app with ?fixture=merge-review). */
export function MergeReviewFixture(): React.JSX.Element {
	const merged = [
		"# GregTech",
		"general {",
		CONFLICT_START,
		"    B:machineFireExplosions=false",
		CONFLICT_SEPARATOR,
		"    B:machineFireExplosions=true",
		CONFLICT_END,
		"    I:pollutionSmogLimit=400000",
		"    B:enableAchievements=false",
		"    B:newOption=true",
		"}",
	].join("\n");

	return (
		<MergeReviewDialog
			file={{ path: "config/GregTech/GregTech.cfg", kind: "conflict" }}
			document={{ contentKind: "text", base: BASE.join("\n"), old: OLD.join("\n"), new: NEW.join("\n"), merged, conflictCount: 1 }}
			busy={false}
			onClose={() => undefined}
			onDecide={() => undefined}
			onWrite={() => undefined}
		/>
	);
}
