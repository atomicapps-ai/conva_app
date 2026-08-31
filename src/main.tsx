import React from "react";
import ReactDOM from "react-dom/client";

import App from "@/App";
import { BackendProvider } from "@/lib/backend";
import { HudPanel } from "@/components/hud/HudPanel";
import { PartnerWindow } from "@/components/partner/PartnerWindow";
import { SplashScreen } from "@/components/SplashScreen";
import { PLATFORM } from "@/lib/platform";
import "@/styles/globals.css";

// Tag the root with the platform so the skin layer in globals.css can override
// base tokens for web only (the desktop cockpit skin is the base). See
// src/lib/platform.ts for the whole web-vs-desktop divergence model.
document.documentElement.dataset.platform = PLATFORM;

// The `hud` window loads the same bundle with `?hud=1` (see src-tauri/src/hud.rs)
// so desktop + HUD share one build. Branch synchronously on that query and tag
// the root element so the HUD's transparent-background styles apply.
const isHud = new URLSearchParams(window.location.search).has("hud");
if (isHud) document.documentElement.dataset.window = "hud";

// The `partner` window (src-tauri/src/partner.rs) loads the same bundle with
// `?partner=1` — a large reading surface for one term, docked to the app's
// right edge by default.
const isPartner = new URLSearchParams(window.location.search).has("partner");
if (isPartner) document.documentElement.dataset.window = "partner";

// The `splash` window (src-tauri/src/splash.rs) loads the same bundle with
// `?splash=1` — shown at launch until the main window's own init() settles.
const isSplash = new URLSearchParams(window.location.search).has("splash");
if (isSplash) document.documentElement.dataset.window = "splash";

// BackendProvider resolves the platform once (Tauri on desktop, Web in a browser)
// and hands the same interface to the whole tree — this bundle is what both the
// desktop WebView and the web build (`npm run build:web`) render.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <BackendProvider>
      {isHud ? (
        <HudPanel />
      ) : isPartner ? (
        <PartnerWindow />
      ) : isSplash ? (
        <SplashScreen />
      ) : (
        <App />
      )}
    </BackendProvider>
  </React.StrictMode>,
);
