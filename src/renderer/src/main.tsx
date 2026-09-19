import React from "react";
import ReactDOM from "react-dom/client";
import { CssBaseline, ThemeProvider, createTheme } from "@mui/material";
import { App } from "./App";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/700.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./styles.css";

const theme = createTheme({
  palette: {
    mode: "dark",
    primary: { main: "#86c06c" },
    secondary: { main: "#e4a44b" },
    background: { default: "#0b1118", paper: "#131c26" },
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: '"IBM Plex Sans", sans-serif',
    h4: { fontWeight: 750, letterSpacing: "-0.03em" },
    button: { textTransform: "none", fontWeight: 700 },
  },
});

const content = typeof window.gtnh === "object"
  ? <App />
  : <main className="startup-failure">
      <h1>GTNH Server Updater could not start</h1>
      <p>The secure desktop bridge did not load. Restart the application or reinstall this build.</p>
    </main>;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {content}
    </ThemeProvider>
  </React.StrictMode>,
);
