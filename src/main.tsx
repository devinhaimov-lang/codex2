import React from "react";
import ReactDOM from "react-dom/client";
import LiteApp from "./LiteApp";
import { initI18n } from "./i18n";
import { AppRuntimeGuard } from "./components/AppRuntimeGuard";

void initI18n();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppRuntimeGuard>
      <LiteApp />
    </AppRuntimeGuard>
  </React.StrictMode>,
);
