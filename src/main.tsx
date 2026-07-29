import React from "react";
import ReactDOM from "react-dom/client";

import App from "@/App";
import { HudPanel } from "@/components/hud/HudPanel";
import "@/styles/globals.css";

// The `hud` window loads the same bundle with `?hud=1` (see src-tauri/src/hud.rs)
// so desktop + HUD share one build. Branch synchronously on that query and tag
// the root element so the HUD's transparent-background styles apply.
const isHud = new URLSearchParams(window.location.search).has("hud");
if (isHud) document.documentElement.dataset.window = "hud";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{isHud ? <HudPanel /> : <App />}</React.StrictMode>,
);
