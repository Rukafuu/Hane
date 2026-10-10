import React from "react";
import { createRoot } from "react-dom/client";
import { HaneApp } from "./HaneApp.jsx";
import ProfileGate from "./PersonalProfile.jsx";
import { AvatarPlayground } from "./AvatarPlayground.jsx";
import "./hane.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {new URLSearchParams(window.location.search).has("avatar-playground") ? <AvatarPlayground /> : <ProfileGate renderWorkspace={props => <HaneApp {...props} />} />}
  </React.StrictMode>,
);
