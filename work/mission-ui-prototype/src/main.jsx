import React from "react";
import { createRoot } from "react-dom/client";
import { HaneApp } from "./HaneApp.jsx";
import "./hane.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <HaneApp />
  </React.StrictMode>,
);
