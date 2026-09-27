# Tiers design

## Overview

Tiers is a single-page Sepolia experiment for someone connecting a browser wallet, inspecting their fee tier and making a test swap. The implemented direction uses a warm paper background, dark green ink, a restrained pale-green action color and large serif headings. This was an implementation choice inferred from the brief. The primary form and personal standing sit together; public pool data, events and fee burning follow in reading order.

This document lives in `docs/` because the assignment's write allowlist forbids creating a root `DESIGN.md`.

## Colors

Canonical values live in `web/src/style.css`, in one light theme. The root primitives map to semantic roles:

| Role | Token | Value |
| --- | --- | --- |
| Page | `--bg` → `--cream-100` | `#f5f3ec` |
| Panel | `--surface` → `--cream-50` | `#fcfbf7` |
| Structural border | `--border` → `--cream-200` | `#e8e5d9` |
| Main text | `--text` → `--ink-900` | `#26342b` |
| Secondary text | `--muted` → `--ink-600` | `#576158` |
| Primary action fill | `--accent` → `--green-500` | `#c3dba8` |
| Accent text and focus | `--accent-text` → `--green-800` | `#335c39` |
| Context surface | `--soft` → `--green-100` | `#e4ebdc` |
| Error text | `--danger` → `--red-700` | `#943d30` |

Control borders use `#8a9485`; input placeholders use `#7c8378`; primary hover is `#b2cd94`. Disabled controls use 0.52 opacity and are accompanied by visible prerequisite text. Current tier has a pale-green row **and** a “Current” label. Errors, network failures, loading and success all have text, so color is never their only cue. Measured rendered contrast pairs are recorded in `frontend/contrast.json`; automated findings and manual limitations are in `VALIDATION.md`. The light decorative tier numeral is not information users need to read.

## Typography

The system font stack is `Arial, Helvetica, sans-serif`, with `Georgia, 'Times New Roman', serif` for the hero, tier title and burn heading. No font files or remote font requests are used. Actual platform fallback can differ. Body is 16px, line-height 1.5, weight 400; meaningful strong/button text uses 600, brand and eyebrow use 700. `font-synthesis: none`, font smoothing and tabular numerals are set at the root.

The hero is `clamp(44px, 5.7vw, 72px)` with line-height 1.04 and −3px tracking; below 46rem it uses 48px and −2px. Section headings are 21px/1.25 (20px on narrow screens); standing title 34px, then 30px/29px at breakpoints. Numeric amount entry is 32px and estimate 26px. Supporting copy is 12–14px, with 11px compact table/eyebrow metadata and a 10px “Current” marker. These are supporting labels, not long-form body text. Inputs/selects stay at least 16px. Changing numbers use tabular figures; long addresses and errors wrap. Paragraphs use `text-wrap: pretty`; the hero balances its lines. Extended explanation is capped at 65ch.

## Layout

`.wrap` caps content at 1120px. Desktop side margins total 80px; at 62rem they total 48px, and at 46rem they total 32px. The header is in normal flow. The primary `.workspace` uses `1fr 1.12fr` columns and a 28px gap. Panels use 28px padding, reduced to 22px. The lower grid reverses the proportions for activity and burn. Related controls use roughly 8–12px spacing; sections use 24–55px. Copy and controls align to panel edges.

At 62rem, grids tighten, the decorative hero numeral disappears and the tier illustration is hidden while columns remain. At 46rem, both grids and explanatory notes stack in DOM order, the network/wallet header stacks its controls, the refresh button spans the available width, and deployment details become one column. The tier illustration reappears in the wider single-column card. The native details element exposes long addresses without truncation. There are no sticky overlays or horizontal carousels.

Production screenshots and overflow assertions cover 1440, 900, 390 and 320 CSS pixels. A 200% root-text enlargement test is recorded separately from browser-native zoom, which was not performed. English is the only supplied locale; native device and RTL/localization review were not performed.

## Elevation & depth

The page is mostly flat. Warm surface changes group sections. The trade panel uses `0 6px 18px #26342b06`; selected direction uses `0 2px 3px #26342b06`. Borders establish structure. The burn panel and current tier use the soft contextual surface. Only the skip link uses elevated positioning (`z-index: 2`); it becomes visible on focus. No modal/dialog system exists.

## Shapes

Panels are 18px radius, 15px on mobile. Inputs use 12px, direction group 10px, buttons 9px, selects 8px. Currency and event markers are circles. The tiny brand mark and four tier bars are CSS shapes, contain no fetched assets and are hidden from assistive technology. The progress indicator is a native `progress` element with a visible contextual sentence.

## Components

Patterns live in `web/src/App.tsx` and shared CSS in `web/src/style.css`; these are page patterns, not a separately published component library.

- **Buttons:** neutral by default; `.primary` marks the next primary swap step and `.full` fills the panel width. Native buttons supply keyboard activation. Disabled states preserve their label. Loading labels name the pending operation. One swap step is emphasized at a time.
- **Direction group:** two native buttons with `aria-pressed` in a named group. Both remain reachable by Tab. The selection is visible by fill/border as well as its pressed state.
- **Amount field:** persistent label, decimal input mode, paste support, inline error tied through `aria-describedby`, `aria-invalid` on invalid input, and focus moved back on validation failure. The output estimate is separately labeled.
- **Standing/table:** loading/disconnected placeholders, then live volume, next threshold, native progress and semantic table headers. Current tier has a textual marker. The table describes the pre-swap fee rule below it.
- **Feedback:** one stable polite status region, persistent errors in alerts, and an explorer link after transaction submission. Wallet rejection and simulation failure keep the form usable.
- **Activity:** bounded, explicitly dated-by-block event window with individual explorer links. Empty and failed states are distinct.
- **Burn:** accrued claims, destination consequence, native checkbox acknowledgement and separately gated action. It has no reward language.
- **Details:** native disclosure for complete addresses, pool/source identifiers, ABIs and manifest. No custom focus trap is needed.

Focus uses a 3px solid accent outline with 4px offset. Forced-colors mode uses system Highlight. Buttons have a 46px minimum height; compact header controls use 40px on mobile. The only animation is a 120ms background-color transition, opted in through `prefers-reduced-motion: no-preference`. There are no entrance animations.

## Do's and don'ts

Reuse `.wrap`, `.panel`, `.section-top`, `.quiet`, `.notice`, `.error`, `.primary` and `.full` when extending the page. Keep primary transaction details in normal reading order. Pair status colors with words. Keep money math in bigint and visual formatting separate. Surface missing prerequisites and signed-transaction limitations beside the form. Preserve a single runtime deployment manifest and verified ABI loader.

Do not convert the price movement limit into a promised output minimum, hide exact addresses behind irreversible truncation, add competing bright action fills, add remote visual assets, or describe mock screenshots as live-chain evidence. Any new page would need an explicitly exported entry or hash routing to preserve static subpath hosting.

## Attribution

Design principles were adapted from Jakub Krehel's [Better Interface, pinned commit 267330e](https://github.com/jakubkrehel/skills/tree/267330e1adfc66a718fb65fa6918c1f06d0a689e/skills/better-interface), MIT. The documentation method was adapted from Paul Bakaus's [Impeccable document guide, pinned commit 9d715cc](https://github.com/pbakaus/impeccable/blob/9d715cc4f5564a990ca8345abfdd5df6dc9b41c8/skill/reference/document.md), Apache-2.0. These upstream works retain their respective licenses; applying their guidance does not relicense either work. The assignment supplied the pinned combined reference, which was read locally.
