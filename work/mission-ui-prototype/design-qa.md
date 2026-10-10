# Design QA

## 2026-10-09 — Clean desktop messenger pass

### Comparison target

- User-provided Grokbot reference: `C:\Users\amari\AppData\Local\Temp\codex-clipboard-db47b67e-ba40-48f3-9842-9738ce63e29a.png`.
- User-provided OpenAI Dots reference: `C:\Users\amari\AppData\Local\Temp\codex-clipboard-4b154256-583b-4885-97cf-61fb44192210.png`.
- Implementation: local Hane preview at `http://127.0.0.1:4173/`, inspected in the in-app browser after the clean-surface pass.

### What was intentionally carried forward

- Three calm reading columns: navigation, conversation, and an inspectable work/session panel.
- White and near-white planes, neutral hairline dividers, compact selected rows, a low-ornament composer, and a bounded dark preview for the virtual workstation.
- Hane ownership remains visible through Hane Sans, the official logo, Portuguese orchestration content, operational status colors, and pink as the action/review accent.

### What was intentionally not copied

- No third-party name, mascot, iconography, sample content, browser chrome, or pink/purple product palette was reused.
- The computer view remains an auditable execution preview. It does not claim live machine control or hide the capability and action-approval boundary.

### Results

- No layout overflow, overlap, unreadable persistent copy, or console error observed in the local desktop preview.
- The prior fog-gray/neumorphic treatment was removed from the active messenger surface; the column hierarchy is now carried by dividers, selected-row fill, and the dark workstation stage.

final result: passed

## Comparison target

- Source visual truth: `reference-hane.webp`, the current Figma Make thumbnail for file `38Ec7AheHrZceisZcyp1qy`.
- Source pixels: 800 × 675, WebP.
- Supporting selected source: the user-provided Figma preview screenshot from the approved design review.
- Implementation: browser-rendered local prototype at `http://127.0.0.1:4173/`.
- Implementation capture: `implementation-hane.png`.
- Implementation pixels / CSS viewport: 1440 × 900 at device scale factor 1.
- Combined comparison: `design-comparison.png`, with each full view contained in an 800 × 900 comparison cell.
- State: `Equipe de Desenvolvimento` selected; group settings closed; approval pending.

## Full-view comparison evidence

The source and implementation were placed in the same 1600 × 900 comparison image and inspected together. The implementation preserves the defining composition: conversation rail, flexible central collaboration thread, live context rail, fixed composer, compact agent/status language, and pink review action. The later clean-messenger pass supersedes the former fog-gray treatment: the desktop workspace now uses white/near-white planes, neutral dividers, selected-row fills, and a bounded dark workstation stage.

The official Hane horizontal logo intentionally replaces the source's text-only wordmark. Following direct readability review, Segoe UI Variable intentionally replaces the source's generic UI font and the thinner Hane Sans trial while preserving the compact hierarchy.

## Focused region comparison evidence

The source thumbnail is only 800 × 675, so it does not support honest pixel-level comparison of tiny metadata. The implementation itself was inspected at its native 1440 × 900 capture for the high-density regions: conversation selection, delegation rows, code result, context preview, artifact list, approval card, and composer. No crop-based source claim is made beyond what remains legible in the source thumbnail.

## Findings

No actionable P0/P1/P2 issue remains for the selected desktop state.

- [P3] The official Hane logo is visually larger and more distinctive than the Figma text wordmark. This is an intentional product improvement requested by the user and uses the supplied production asset rather than an approximation.
- [P3] The compact three-column layout should still be reassessed at Windows text scaling above 100% before desktop release, although persistent metadata is now 9px or larger at 100% scaling.

## Comparison history

1. The first implementation capture reproduced the full three-column anatomy and source content without visible overflow at 1440 × 900.
2. The browser run reported a missing favicon request. The official Hane app icon was added to `index.html`; the second run reported zero console errors. This did not change the application layout.
3. Direct review found 6–10px copy too delicate and the continuous pale background too bright. The final pass moved body copy to 12.5px, persistent metadata to 9px or larger, made Hane Sans Medium the interface default, and increased surface separation with a darker fog-gray base. A fresh 1440 × 900 capture showed no clipping or overlap.
4. The Hane Sans trial still lacked enough optical fill at desktop UI sizes. The implementation moved to Segoe UI Variable with 450 body, 500 metadata, and 600–650 title/action weights; a fresh capture preserved all card heights and line wrapping with visibly stronger hierarchy.

## Required fidelity surfaces

- **Fonts and typography:** Segoe UI Variable is the primary interface family, with Segoe UI and system-ui fallbacks; Cascadia Code/Cascadia Mono serve execution output. Body copy uses 450, metadata 500, and titles/actions 600–650. Body copy remains 12.5px and persistent metadata at least 9px at normal scaling, with explicit line heights and tabular numerals for operational data.
- **Spacing and layout rhythm:** Three desktop columns, 70px headers, central reading width, 11–16px radii, readable task rows, pinned composer, and right-panel section rhythm preserve the source composition without its micro-density.
- **Colors and visual tokens:** White and near-white workspace planes, neutral dividers, charcoal text, restrained Hane pink, and separate blue/green/amber operational states are present. Pink is reserved for brand and review actions.
- **Image quality and asset fidelity:** The implementation uses the supplied transparent Hane logo. Interface symbols use the installed Phosphor library; no emoji, Lucide dependency, or approximate brand drawing was introduced.
- **Copy and content:** Agent names, Portuguese orchestration dialogue, task plan, generated artifacts, uncertainty boundary, and explicit review action match the approved concept.

## Primary interactions tested

- Switching between `Equipe de Desenvolvimento` and `Planejamento do lançamento`.
- Opening and closing group settings.
- Sending a message through the composer.
- Reviewing and approving the plan.
- Browser console check: zero errors after the favicon fix.

## Implementation checklist

- [x] Import official Hane logo and app icon.
- [x] Establish the user-approved Segoe UI Variable hierarchy and monospace fallback stack.
- [x] Recreate the approved three-column workspace.
- [x] Preserve working conversation, group, composer, artifact, and approval controls.
- [x] Verify 1440 × 900 rendering and console health.
- [x] Apply and recapture the user-requested readability and contrast pass.
- [x] Pass the repository UI build and Sites artifact tests.

## Follow-up polish

- Validate Windows 125% text scaling when the Electron/Tauri desktop shell is introduced.
- Replace prototype data with persisted task-run and provider state when the UI/core integration slice is authorized.

final result: passed
