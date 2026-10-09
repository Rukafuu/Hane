# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

The approved Hane workspace direction is the Figma Make file `38Ec7AheHrZceisZcyp1qy`: a light, three-column desktop messenger for collaborative agents. Reuse the official brand assets from `A:\Hane\src`; keep pink as the brand/action accent, and use distinct blue, green, amber, and red tokens for operational states. Preserve explicit human review before consequential agent actions.

Readability takes priority over the source mockup's micro-density. At normal Windows scaling, keep persistent UI text at 9px or larger, body copy at 12px or larger, and use genuine weight contrast for small labels. The workspace base should be a darker fog-gray with visibly lighter elevated surfaces; avoid a continuous near-white canvas that flattens column and card hierarchy.

Use `Hane Sans` as the primary interface family, with `Segoe UI Variable Text`, `Segoe UI` and `system-ui` as fallbacks only. The 0.2 cut lacked optical fill at desktop UI sizes and Segoe replaced it in the 2026-10-09 readability review; the 0.3 cut (denser hairlines, stems and a new SemiBold 600, generated in `A:\Hane\src\Hane fonts\Hane-v0.3`) is the WOFF2 set in `src/fonts/`. Keep `font-synthesis: none` so real weights, not fake bolds, carry the hierarchy: 400 for body copy (450 declarations resolve to 400), 500 for metadata, 600 for titles and actions (650 resolves to 600). Preserve comfortable line height and tabular numerals for timestamps and progress data.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

Motion uses anime.js v4 (`animate`, `stagger`) and lives only in `src/motion.js`; components import helpers from there instead of calling anime.js directly. Keep animation values explicit (`[from, to]`) because anime.js seeds its transform model from inline styles, not class rules, and every mount animation must `revert()` on cleanup so React StrictMode replays correctly. CSS must not animate properties owned by motion (the spinner, toast entry, and leader toggle knob are driven by anime.js). Honor `prefers-reduced-motion` through the shared `reduceMotion()` guard.

