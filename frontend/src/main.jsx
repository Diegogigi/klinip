import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";

import "./fonts/nunito.css";
import "./styles.css";

function normalizeLegacySpaUrl() {
  const { pathname, search, hash } = window.location;
  if (hash && hash !== "#") return;

  const normalizedPath =
    pathname.length > 1 && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname;

  const legacyPublicRoute =
    normalizedPath.startsWith("/voice/shared/") ||
    normalizedPath === "/settings" ||
    normalizedPath === "/reset-password";

  if (!legacyPublicRoute) return;

  window.history.replaceState(
    window.history.state,
    "",
    `/#${normalizedPath}${search || ""}`
  );
}

normalizeLegacySpaUrl();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>
);
