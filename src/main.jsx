import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

// Kept from the artifact version: the dashboard stores small display preferences (whether
// amounts are censored) through this interface. Portfolio data no longer travels through
// it -- that lives in the database now, behind the API.
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
    <App />
  </React.StrictMode>,
);
