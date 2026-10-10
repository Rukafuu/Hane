// Exact default origins for the bundled Vite development and preview UIs.
// Other local ports still require explicit --ui-origin; never allow all localhost.
export const DEFAULT_UI_ORIGINS = Object.freeze([
  'http://localhost:5173', 'http://127.0.0.1:5173',
  'http://localhost:4173', 'http://127.0.0.1:4173',
]);
