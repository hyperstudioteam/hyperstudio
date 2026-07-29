import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initContributions } from "./plugins/init";
import { initTheme } from "./theme";

initTheme();
initContributions();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
