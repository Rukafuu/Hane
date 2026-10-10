import React from "react";
import { createRoot } from "react-dom/client";
import { HaneApp } from "./HaneApp.jsx";
import { AvatarPlayground } from "./AvatarPlayground.jsx";
import "./hane.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {new URLSearchParams(window.location.search).has("avatar-playground") ? <AvatarPlayground /> : <HaneApp />}
  </React.StrictMode>,
);
