import { createTheme } from "@mui/material";

/**
 * "Schematic sheet": navy ink on pale drafting film. Square 2 px ink outlines mark what can
 * be acted on; colour is kept for state only (done, running, fault).
 */
export const ink = {
	film: "#e8eef1",
	grid: "#d3dee5",
	paper: "#f6f9fa",
	ink: "#16324e",
	soft: "#52687d",
	rule: "#9fb3c3",
	done: "#2f7a4b",
	live: "#b35f00",
	fault: "#b3261e",
	/** Merge review: the old server side and the new version side. */
	old: "#2f7a4b",
	new: "#2f6fb3",
} as const;

export const SANS = '"Archivo Variable", "Archivo", sans-serif';
export const MONO = '"IBM Plex Mono", monospace';

const outline = `2px solid ${ink.ink}`;

export const theme = createTheme({
	palette: {
		mode: "light",
		primary: { main: ink.ink, contrastText: ink.paper },
		secondary: { main: ink.soft, contrastText: ink.paper },
		success: { main: ink.done },
		warning: { main: ink.live },
		error: { main: ink.fault },
		info: { main: ink.ink },
		text: { primary: ink.ink, secondary: ink.soft },
		divider: ink.rule,
		background: { default: ink.film, paper: ink.paper },
	},
	shape: { borderRadius: 0 },
	typography: {
		fontFamily: SANS,
		fontSize: 14,
		h4: { fontWeight: 800, fontStretch: "125%", letterSpacing: "-0.01em", lineHeight: 1.05 },
		h5: { fontWeight: 800, fontStretch: "125%", lineHeight: 1.1 },
		h6: { fontWeight: 750, fontStretch: "112%", fontSize: "1.1rem", lineHeight: 1.25 },
		subtitle1: { fontWeight: 650 },
		subtitle2: { fontWeight: 700 },
		button: { textTransform: "none", fontWeight: 700, letterSpacing: 0 },
		caption: { fontSize: "0.8rem" },
	},
	components: {
		MuiCssBaseline: {
			styleOverrides: { body: { fontVariantNumeric: "tabular-nums" } },
		},
		MuiPaper: {
			defaultProps: { elevation: 0 },
			styleOverrides: { root: { backgroundImage: "none" }, outlined: { border: outline } },
		},
		MuiButton: {
			defaultProps: { disableElevation: true },
			styleOverrides: {
				root: { borderRadius: 0, paddingInline: 16 },
				contained: { border: outline, "&.Mui-disabled": { borderColor: ink.rule } },
				outlined: { border: outline, "&:hover": { border: outline, backgroundColor: ink.film } },
				sizeLarge: { paddingBlock: 10, fontSize: "1rem" },
			},
		},
		MuiIconButton: { styleOverrides: { root: { borderRadius: 0 } } },
		MuiOutlinedInput: {
			styleOverrides: {
				root: {
					backgroundColor: ink.paper,
					"& .MuiOutlinedInput-notchedOutline": { borderColor: ink.rule, borderWidth: 1.5 },
					"&:hover .MuiOutlinedInput-notchedOutline": { borderColor: ink.soft },
					"&.Mui-focused .MuiOutlinedInput-notchedOutline": { borderColor: ink.ink, borderWidth: 2 },
				},
			},
		},
		MuiChip: {
			styleOverrides: {
				root: { borderRadius: 0, fontWeight: 650, height: 26 },
				outlined: { borderWidth: 1.5 },
			},
		},
		MuiAlert: {
			defaultProps: { variant: "outlined" },
			styleOverrides: {
				root: { borderRadius: 0, borderWidth: 0, borderLeftWidth: 4, backgroundColor: ink.paper, color: ink.ink, alignItems: "flex-start" },
			},
		},
		MuiDialog: {
			styleOverrides: { paper: { border: outline, boxShadow: `8px 8px 0 ${ink.grid}` } },
		},
		MuiDialogTitle: { styleOverrides: { root: { fontWeight: 800, fontStretch: "118%" } } },
		MuiLinearProgress: {
			styleOverrides: { root: { height: 6, backgroundColor: ink.grid }, bar: { backgroundColor: ink.live } },
		},
		MuiCheckbox: { defaultProps: { color: "primary" } },
		MuiRadio: { defaultProps: { color: "primary" } },
		MuiTooltip: { styleOverrides: { tooltip: { borderRadius: 0, backgroundColor: ink.ink, fontSize: 13 } } },
		MuiTab: { styleOverrides: { root: { textTransform: "none", fontWeight: 700 } } },
		MuiToggleButton: { styleOverrides: { root: { borderRadius: 0, textTransform: "none" } } },
	},
});
