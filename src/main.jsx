import React from "react";
import { createRoot } from "react-dom/client";
import PortfolioDashboard from "../portfolio_dashboard.jsx";

// The dashboard was written against the Claude artifact runtime, which supplies a
// promise-based `window.storage` returning { value } records. Outside that runtime the
// object does not exist, so every read throws and every save reports "บันทึกไม่สำเร็จ".
// This shim gives it the same contract on top of localStorage, which keeps the data on
// this machine and in this browser -- the same place the artifact kept it.
if (!window.storage) {
  window.storage = {
    async get(key) {
      const value = localStorage.getItem(key);
      return value === null ? null : { value };
    },
    async set(key, value) {
      localStorage.setItem(key, String(value));
    },
  };
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <PortfolioDashboard />
  </React.StrictMode>
);
