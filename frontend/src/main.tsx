import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Fonts are bundled with the app (no request to Google Fonts at runtime).
import "@fontsource-variable/archivo/wdth.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./styles.css";
import { App } from "./App";

// Find <div id="root"> in index.html and let React draw the app inside it.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
