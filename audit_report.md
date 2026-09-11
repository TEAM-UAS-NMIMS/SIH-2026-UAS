# gridZERO — Full Audit Report
_Read-only audit. No code was changed._

---

## STATUS KEY

| Badge | Meaning |
|---|---|
| **WORKING** | Fully wired to real data, behaves correctly end-to-end |
| **PARTIAL** | Wired but incomplete — some sub-feature missing, silently wrong, or gated incorrectly |
| **BROKEN** | Code exists but the feature does not work as expected |
| **MISSING** | Feature described in scope or obviously needed, with no implementation at all |

---

## Global / Cross-Cutting

| # | Item | Status | Notes |
|---|---|---|---|
| G1 | Default route `/` → `/live` | **BROKEN** | `App.jsx:15` redirects `/` to `/live` instead of `/preflight`. Operator lands on a live screen with zero telemetry before doing any checks. Should be `/preflight`. |
| G2 | Phase badge in StatusBar vs actual screen | **PARTIAL** | Badge reads `telemetry.phase` — correct. But if user navigates via URL bar without calling `POST /api/mission/phase`, badge drifts from what the screen is showing. |
| G3 | WS auto-reconnect with exponential backoff | **WORKING** | 500 ms → 16 s backoff; countdown shown in StatusBar. |
| G4 | Telemetry STALE badge (> 3 s) | **WORKING** | `telemetry_updated_at` broadcast; staleness computed every 1 s; amber STALE pill in StatusBar. |
| G5 | Video signal NO SIGNAL state | **WORKING** | Backend counts consecutive failures; sets `video_signal = False` after 10; frontend shows amber "No Signal" distinct from HTTP-OFFLINE. |
| G6 | WS RECONNECTING countdown | **WORKING** | `wsRetryIn` shown as "RECONNECTING Xs" amber pill. |
| G7 | All four routes reachable | **WORKING** | `/preflight`, `/live`, `/analysis`, `/report` all registered and rendering. |
| G8 | `start.ps1` / `start.sh` one-command launcher | **PARTIAL** | `start.sh` requires WSL/Git Bash (not installed). `start.ps1` fails with "not a valid Win32 application" when launching `npm.cmd` via `Start-Process`. Services must still be started manually. |

---

## Pre-Flight Screen (`/preflight`)

| # | Item | Status | Notes |
|---|---|---|---|
| PF1 | Mission metadata panel (name, operator, area, pattern…) | **WORKING** | `MissionSetupPanel` reads from `TelemetryContext.mission`. All fields display correctly. |
| PF2 | Edit Mission Parameters button | **BROKEN** | Permanently `disabled` (`MissionSetupPanel.jsx:113–119`). No `POST /api/mission` endpoint exists to persist edits. No tooltip explains why. |
| PF3 | Mission map — waypoints, search polygon, hazard zone | **WORKING** | Rendered read-only via react-leaflet; header says "read-only preview." |
| PF4 | Map editing — add/move/delete waypoints | **MISSING** | Completely read-only. No drag, no click-to-add, no polygon editing. Docstring: "static/mock shape for now." No backend endpoint to persist geometry. |
| PF5 | Map stats row (distance, flight time, coverage, battery reserve) | **PARTIAL** | Reads from `mission.stats` — a hardcoded object in `AppState` (`distanceKm: 3.4`, `flightTimeMin: 22`, etc.). Never recomputed from actual waypoints. |
| PF6 | Checklist — Position (GNSS fix, satellites, HDOP, home point) | **WORKING** | All four driven by real `GPS_RAW_INT` / `GLOBAL_POSITION_INT` MAVLink data. States change correctly. |
| PF7 | Checklist — Power (battery %, range estimate) | **WORKING** | Battery % from `SYS_STATUS`. Range warning derives from same value. |
| PF8 | Checklist — Power: cell voltage balance, ESC self-test | **PARTIAL** | Static `pass` — "per-cell data not yet parsed." Clearly labelled but will never change state even with real data; false-green before launch. |
| PF9 | Checklist — Communication: GCS link | **WORKING** | Dynamically inferred from `mode !== "UNKNOWN"` (heartbeat flowing). |
| PF10 | Checklist — Communication: RC RSSI, video downlink | **PARTIAL** | Both static `pass`. `videoSignal` is now tracked in context but **not wired** into the checklist "Video downlink" item — always shows green even when camera is gone. |
| PF11 | Checklist — Airframe section | **PARTIAL** | All four items hardcoded `pass`. No MAVLink equivalent; no operator manual-tick mechanism. Always green. |
| PF12 | Checklist — Payload: YOLO model loaded | **PARTIAL** | Hardcoded `warn`. No `/api/health` model check. Always amber regardless of YOLO state. |
| PF13 | Checklist — Mission Safety: Geofence, Observer | **PARTIAL** | Both static `warn`. No operator acknowledgement flow to flip them to `pass`. |
| PF14 | **Launch button gating** | **BROKEN** | `isLaunchReady = readinessScore >= 90 && warnCount === 0`. Static `warn` items (Geofence, Observer, YOLO, RC RSSI, Video) make `warnCount` always ≥ 4 → **button is permanently disabled** even with perfect GPS and full battery. |
| PF15 | Launch → `POST /api/mission/phase` → navigate `/live` | **WORKING** | Correct when the button can actually be enabled. |
| PF16 | Launch failure error surfaced to user | **BROKEN** | `handleLaunch` only calls `console.error(...)` on failure. No toast or inline message shown to operator. |

---

## Live Rescue Screen (`/live`)

| # | Item | Status | Notes |
|---|---|---|---|
| LR1 | Telemetry column — altitude, speed, heading, battery, mode, satellites, lat/lon | **WORKING** | All from `TelemetryContext.telemetry` via WS. Values update live. |
| LR2 | Attitude indicator (roll/pitch) | **PARTIAL** | SVG widget renders but `roll` and `pitch` default to `0` (`TelemetryColumn.jsx:278-279`). ATTITUDE MAVLink message not parsed in `telemetry.py` → static level horizon during real flight. |
| LR3 | Map panel — drone marker moves with telemetry | **WORKING** | `MapPanel` updates `droneLat/droneLon/droneHeading` on each WS tick. |
| LR4 | Map panel — detection markers with popups | **WORKING** | Priority-coloured markers from `detections[]`; popup shows id/confidence/coords/source/uncertainty. |
| LR5 | Map panel — VIO uncertainty circle | **WORKING** | Dashed circle rendered when `positionSource === "VIO_FALLBACK"`. |
| LR6 | Video feed — MJPEG stream | **WORKING** | `<img>` at `/api/video_feed`; YOLO annotated frames stream in real time. |
| LR7 | Video feed — No Signal placeholder | **WORKING** | Amber distinct from HTTP-OFFLINE. |
| LR8 | Video feed — auto-retry with backoff | **WORKING** | 2 s → 30 s; countdown shown; `imgKey` bumps to re-mount `<img>`. |
| LR9 | Detections panel — live cards from WS | **WORKING** | Confidence ring, priority pill, coordinates, source badge, uncertainty. |
| LR10 | Event timeline — live events | **WORKING** | Auto-scrolls to newest; collapsible; critical/warning count in header. |
| LR11 | **RTL / LAND / HOLD command buttons** | **BROKEN** | `CommandButtons` (`TelemetryColumn.jsx:234-237`) sets a local `sent` state and resets after 1.5 s. No `POST /api/command` endpoint exists. No MAVLink command is sent. Comment: "will be wired in a later step." |
| LR12 | **End Mission button / path to Analysis** | **MISSING** | No "End Mission" UI element anywhere on `LiveRescueScreen`. `POST /api/mission/end` exists and works but has zero UI trigger. Operator cannot end a mission from the app. |
| LR13 | Navigating to `/analysis` with real computed stats | **PARTIAL** | Reachable via nav link. `StatsStrip` fetches `/api/mission/stats`. But without LR12, stats are a live snapshot, not a locked post-mission snapshot, and phase badge still says `LIVE_RESCUE`. |

---

## Analysis Screen (`/analysis`)

| # | Item | Status | Notes |
|---|---|---|---|
| AN1 | Stats strip — duration, area %, detections, GNSS outage, VIO usage | **WORKING** | Self-fetches `/api/mission/stats`; 10 s auto-refresh; error state with retry. |
| AN2 | Stats strip — phase badge hardcoded | **PARTIAL** | `StatsStrip.jsx:133` renders `<span>ANALYSIS</span>` literally — does not read `telemetry.phase`. Will show "ANALYSIS" even if arrived via nav link during `LIVE_RESCUE`. |
| AN3 | Analysis map — flight path polyline | **WORKING** | `AnalysisScreen` accumulates `[lat, lon]` from each WS tick; deduplicates consecutive identical points. |
| AN4 | Analysis map — coverage corridor overlay | **WORKING** | Geometric corridor along polyline. Honestly labelled "not a true coverage algorithm." |
| AN5 | Analysis map — detection markers with click | **WORKING** | Priority circles; click opens `TargetDetailPanel`. Rejected detections dimmed. |
| AN6 | Analysis map — search polygon | **WORKING** | Lime dashed polygon from `mission.searchPolygon`. |
| AN7 | TargetDetailPanel — slide-in on marker click | **WORKING** | Absolute overlay within map column; opens/closes correctly. |
| AN8 | TargetDetailPanel — Confirm/Reject | **WORKING** | Calls `POST /api/detections/{id}/review`; parent state updated immediately via `onReview`. |
| AN9 | TargetDetailPanel — Adjust Priority | **WORKING** | Dropdown + Apply button; backend updates in-place. |
| AN10 | TargetDetailPanel — Analyst notes | **WORKING** | Notes persisted on detection dict in `AppState`. |
| AN11 | **Review persistence across YOLO frames** | **BROKEN** | `AppState.update_detections()` replaces the entire `detections` list with new UUID-keyed dicts on every YOLO inference. Any `confirmed`/`rejected` status is **overwritten within ~150 ms** when the next frame arrives. Reviews are not durable. |
| AN12 | TargetDetailPanel — RGB snapshot | **PARTIAL** | Honestly labelled: "Frame snapshot not available — per-detection frame capture not implemented." Correct, no fake image. |
| AN13 | AnalysisToolsList — 3D Reconstruction, Thermal Map | **WORKING** | Amber "Not available in this build — concept only." No fake data. |
| AN14 | AnalysisToolsList — Coverage Map | **WORKING** | Bounding-box ratio from `flightPath` vs `searchPolygon`; honest disclaimer. |
| AN15 | AnalysisToolsList — Hazard Map | **WORKING** | Filters `events` by severity; "No hazard events logged" when empty. |
| AN16 | AnalysisToolsList — Flight Replay | **WORKING** | Slider over `flightPath`; shows lat/lon/progress per step. Does **not** update the map marker (data display only). |
| AN17 | AnalysisToolsList — Export JSON | **WORKING** | Downloads `{ detections, flight_path, events }` JSON blob. Real data. |
| AN18 | AnalysisToolsList — Generate Report | **WORKING** | Navigates to `/report`. |
| AN19 | **End Mission entry point from Analysis** | **MISSING** | Same gap as LR12 — no "End Mission" button here either. If arrived via nav link, phase is still `LIVE_RESCUE`. |

---

## Report Screen (`/report`)

| # | Item | Status | Notes |
|---|---|---|---|
| RP1 | Fetch `GET /api/report` on mount | **WORKING** | Loading skeleton, error state with retry, successful render all work. |
| RP2 | ReportHeader — mission metadata, tier badge, golden-hour timer | **WORKING** | Timer counts from 72 h; turns amber < 48 h, red < 24 h. Tier badge is outline ring only. |
| RP3 | TopActionsList — numbered rank badges | **WORKING** | Neutral `bg-slate-700` badges (no red/amber/green); top 3 non-rejected. |
| RP4 | RankedFindingsList — full table | **WORKING** | Sticky header, score bars, expandable justification rows with component breakdown. |
| RP5 | Justification strings from real values | **WORKING** | Template-based in `report.py`; confidence %, hazard distance, age, source all real. No hardcoded copy. |
| RP6 | Score component transparency | **WORKING** | Expansion shows `conf×0.50 + prox×0.30 + age×0.20` with actual numbers. |
| RP7 | ExportPanel — CSV download | **WORKING** | Real RFC 4180 CSV, 14 fields, actual file download. |
| RP8 | ExportPanel — PDF / GeoJSON / KML | **WORKING** (honest stub) | "Not available in this build" toast + on-panel disclaimer. Correctly does not fake a download. |
| RP9 | Report with zero detections | **PARTIAL** | Returns cleanly with empty arrays. But `ReportHeader` tier badge falls through to "LOW" with 0 detections — should be neutral "N/A" state. |
| RP10 | Refresh button | **WORKING** | "↻ Refresh Report" re-fetches `/api/report`. |

---

## Backend Endpoints

| Endpoint | Status | Notes |
|---|---|---|
| `GET /health` | **WORKING** | `{"status": "ok"}` |
| `GET /api/telemetry` | **WORKING** | Full `get_state()` snapshot including `telemetry_updated_at` + `video_signal`. |
| `GET /api/video_feed` | **WORKING** | MJPEG stream; `video_signal` updated by pipeline. |
| `GET /api/detections` | **WORKING** | Returns current detections list. |
| `POST /api/mission/phase` | **WORKING** | Validates phase; stamps `mark_mission_start()` on `LIVE_RESCUE`. |
| `POST /api/mission/end` | **WORKING** | Computes stats, sets `ANALYSIS`, logs event, returns stats. |
| `GET /api/mission/stats` | **WORKING** | Cached or live-snapshot. |
| `POST /api/detections/{id}/review` | **BROKEN** | API logic correct but `update_detections()` replaces entire list with new UUID dicts on every YOLO frame → confirmed/rejected status overwritten within ~150 ms. |
| `GET /api/report` | **WORKING** | Ranking + template justifications correct. |
| `POST /api/command` | **MISSING** | No endpoint. RTL/LAND/HOLD are purely visual placeholders. |

---

## Summary: Prioritised Fix List

### [P0] Must Fix Before Demo (breaks the core user flow)

| # | Item | Why |
|---|---|---|
| 1 | **Review persistence (AN11 + backend)** | Confirm/Reject wiped on next YOLO frame — the entire post-mission workflow is broken during live detection. Fix: keep a separate `review_overrides` dict keyed by stable detection ID; merge it into the broadcast list instead of overwriting. |
| 2 | **End Mission button missing (LR12, AN19)** | No UI path from Live Rescue to Analysis. Operator must type curl or click nav link — both bypass the phase transition. |
| 3 | **Launch button permanently disabled (PF14)** | Static `warn` items make `warnCount` always ≥ 4. Gate should only block on dynamic `fail` items, or static warns need operator-acknowledgement toggles. |
| 4 | **Default route `/` → `/preflight` not `/live` (G1)** | Operator lands on a blank live screen with no mission started. |

### [P1] Should Fix Before Demo

| # | Item |
|---|---|
| 5 | Roll/pitch not parsed → attitude indicator always flat (LR2) |
| 6 | RTL/LAND/HOLD no-ops — no `POST /api/command` (LR11) |
| 7 | Launch error not surfaced to user — console only (PF16) |
| 8 | Map stats row always hardcoded defaults (PF5) |
| 9 | `videoSignal` not wired into Pre-Flight checklist "Video downlink" item (PF10) |
| 10 | StatsStrip ANALYSIS badge hardcoded, ignores actual phase (AN2) |
| 11 | Report tier badge shows "LOW" with 0 detections — should be "N/A" (RP9) |

### [P2] Nice to Have / Lower Priority

| # | Item |
|---|---|
| 12 | Map editing (add/drag/delete waypoints) — currently read-only (PF4) |
| 13 | Edit Mission Parameters button always disabled, no persistence endpoint (PF2) |
| 14 | Flight Replay does not move the map marker (AN16) |
| 15 | `start.ps1` broken on this machine; `start.sh` requires WSL (G8) |
| 16 | Phase badge can drift if user navigates directly via URL (G2) |

---
_Audit completed: 2026-09-11. No source files were modified._
