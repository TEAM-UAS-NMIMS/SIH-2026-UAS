# gridZERO — Full Feature Audit

_Read-only code audit. Verified against the working tree on 2026-09-12._
_Supersedes the 2026-09-11 audit, which is now stale in several places._

---

## Executive Summary

The **presentation layer is in good shape**. Routing, the WebSocket pipeline, the
video path, the ranking engine, CSV export and the honest "not implemented"
placeholders are all real and correct. Four items flagged in the previous audit
have since been fixed.

The **data layer is where the product breaks**. One architectural decision —
`AppState.update_detections()` replacing the entire detection list on every
inference frame — silently invalidates the Analysis screen, the review workflow,
the mission report, and the mission statistics. Everything downstream of it
describes *the last 100 ms of video*, not the mission.

Three features are safety-relevant and do not do what the UI implies:
**RTL / LAND / HOLD send nothing**, the **attitude indicator is permanently
level**, and **detection coordinates are computed from the wrong altitude
reference**.

### Fixed since the previous audit

| Item | Was | Now |
|---|---|---|
| Default route `/` | Landed on `/live` | Redirects to `/preflight` — [App.jsx:15](frontend/src/App.jsx#L15) |
| Launch button gating | Permanently disabled (static warns counted) | Gates on `failCount === 0` only — [ChecklistPanel.jsx:183](frontend/src/components/preflight/ChecklistPanel.jsx#L183) |
| Launch failure feedback | `console.error` only | Red error panel above the button — [PreFlightScreen.jsx:217](frontend/src/screens/PreFlightScreen.jsx#L217) |
| Mission map editing | Read-only | Add / drag / delete waypoints + polygon vertices — [MissionMapEditor.jsx](frontend/src/components/preflight/MissionMapEditor.jsx) |

---

## Status Key

| Badge | Meaning |
|---|---|
| **WORKING** | Wired to real data, behaves correctly end-to-end |
| **PARTIAL** | Wired but incomplete — a sub-feature is missing or silently wrong |
| **BROKEN** | Code exists but the feature does not do what the UI implies |
| **MISSING** | Needed for the described flow, no implementation |

---

## P0 — The Architectural Defect

Everything in this section traces to one function:

```python
# backend/app/state.py:129
def update_detections(self, detections):
    with self._lock:
        self.detections = detections      # replaces the whole list
```

`DetectionPipeline._run_loop()` calls this on **every 3rd frame** with a brand-new
list, where each detection is built with a **fresh `uuid4()` and a fresh
`timestamp`** ([detection.py:195-206](backend/app/detection.py#L195)).

There is no tracking, no accumulation, and no stable identity across frames.

### What this breaks

| Consequence | Detail |
|---|---|
| **Detections do not accumulate** | The list is *the current frame's* detections. A survivor spotted at minute 3 is gone from the system by minute 3.001. There is no mission-wide detection history anywhere in the backend. |
| **Confirm / Reject is not durable** | `POST /api/detections/{id}/review` writes `status` onto a dict that is discarded ~100 ms later. The API returns `200 OK` and the change is real — for one frame. |
| **Frontend merge-by-id cannot help** | [AnalysisScreen.jsx:43](frontend/src/screens/AnalysisScreen.jsx#L43) merges `prevMap[d.id]` to preserve reviews, but IDs are regenerated every frame so the lookup **never matches**. The mitigation is dead code. |
| **The report describes one video frame** | `GET /api/report` ranks `app_state.detections` — the last frame. A 20-minute mission with 40 sightings produces a report listing whatever happened to be on screen when you clicked. |
| **`detection_count` is wrong** | `compute_mission_stats()` sums `survivors_by_priority` from the same per-frame list ([state.py:207](backend/app/state.py#L207)). |
| **The age score is dead weight** | `age_score = (now - timestamp) / 600`. Timestamps are always < 1 s old, so `age_score` is effectively 0 **always**. The documented 20 % age weight contributes nothing to any ranking. |

**Fix direction:** introduce a persistent detection store keyed by a stable track
ID. Assign identity by spatial/temporal proximity (IoU on the bbox across
consecutive frames, or a simple centroid-distance tracker), keep the
highest-confidence observation per track, and hold `review_overrides` in a
separate dict merged on read so a new frame can never clobber an analyst's
decision. The live panel shows active tracks; the report reads the full
accumulated set.

---

## Global / Cross-Cutting

| # | Item | Status | Notes |
|---|---|---|---|
| G1 | Default route → `/preflight` | **WORKING** | Fixed. [App.jsx:15](frontend/src/App.jsx#L15) |
| G2 | Phase badge vs actual screen | **PARTIAL** | Badge reads `telemetry.phase`, but nav links change the route without calling `POST /api/mission/phase`, so badge and screen drift. |
| G3 | WS auto-reconnect, exponential backoff | **WORKING** | 500 ms to 16 s, countdown in StatusBar. |
| G4 | Telemetry STALE badge (> 3 s) | **WORKING** | Driven by `telemetry_updated_at`. |
| G5 | Video NO SIGNAL state | **WORKING** | 10 consecutive read failures flips `video_signal`; recovers on next good read. |
| G6 | WS RECONNECTING countdown | **WORKING** | |
| G7 | All four routes reachable | **WORKING** | |
| G8 | `start.ps1` / `start.sh` launcher | **PARTIAL** | `start.ps1` uses `$IsWindows`, which is **undefined in Windows PowerShell 5.1** (the shell on this machine), so `$npmCmd` resolves to `npm` and `Start-Process` fails. Services must be started manually. |
| G9 | **Unbounded in-memory growth** | **BROKEN** | `events` ([state.py:143](backend/app/state.py#L143)) and `_position_history` ([state.py:117](backend/app/state.py#L117)) append forever with no cap. `_position_history` grows at the MAVLink position rate (~5-10 Hz) for the life of the process. A long mission will exhaust memory; nothing is ever trimmed or persisted. |
| G10 | **No persistence of any kind** | **MISSING** | All state is in-process memory. A backend restart loses the mission, every detection, every review and the full event log. There is no database despite the repo being named `gridZERO-db`. |
| G11 | Hardcoded `localhost:8000` in frontend | **PARTIAL** | The API base is inlined in several files rather than read from `import.meta.env`. The GCS cannot be served from any host other than the machine running the backend. |

---

## Pre-Flight Screen (`/preflight`)

**Intent:** configure the mission, plan the search geometry, verify the aircraft
is airworthy, and gate launch on that verification.

| # | Item | Status | Notes |
|---|---|---|---|
| PF1 | Mission metadata panel | **WORKING** | Reads `TelemetryContext.mission`. |
| PF2 | Edit Mission Parameters | **BROKEN** | Button is hardcoded `disabled` ([MissionSetupPanel.jsx:114](frontend/src/components/preflight/MissionSetupPanel.jsx#L114)). No `POST /api/mission` endpoint exists. No tooltip explains why it is dead. |
| PF3 | Map — waypoints, polygon, hazard zone | **WORKING** | Rendered via react-leaflet. |
| PF4 | Map editing — add / drag / delete | **PARTIAL** | Editing now works in the UI. **But edits live only in `useState` inside PreFlightScreen** ([PreFlightScreen.jsx:188-189](frontend/src/screens/PreFlightScreen.jsx#L188)) and are never POSTed anywhere. Navigating away or reloading discards the entire flight plan. The aircraft never receives it. |
| PF5 | Map stats row | **PARTIAL** | Reads `mission.stats`, a hardcoded literal (`distanceKm: 3.4`, `flightTimeMin: 22`…) at [state.py:85](backend/app/state.py#L85). Never recomputed from the waypoints the operator just drew — so the numbers actively contradict the map. |
| PF6 | Checklist — Position (fix, sats, HDOP, home) | **WORKING** | Genuinely driven by `GPS_RAW_INT` / `GLOBAL_POSITION_INT`. |
| PF7 | Checklist — Battery charge, range | **WORKING** | From `SYS_STATUS`. |
| PF8 | Checklist — cell balance, ESC self-test | **PARTIAL** | Static `pass`. Labelled honestly in the detail line, but renders green — a false all-clear on two genuinely safety-relevant checks. |
| PF9 | Checklist — GCS link | **WORKING** | Inferred from `mode !== "UNKNOWN"`. |
| PF10 | Checklist — RC RSSI, video downlink | **PARTIAL** | Both static `pass`. `videoSignal` **is** tracked in context but still not wired into "Video downlink connected" — it shows green with the camera unplugged. This is a one-line fix with data already on hand. |
| PF11 | Checklist — Airframe (4 items) | **PARTIAL** | All hardcoded `pass`. No operator tick mechanism, so they are decorative. |
| PF12 | Checklist — YOLO model loaded | **PARTIAL** | Hardcoded `warn`. The model is loaded eagerly at import ([detection.py:79](backend/app/detection.py#L79)) so real status is trivially available via `/health`. |
| PF13 | Checklist — Geofence, Observer | **PARTIAL** | Static `warn`, no acknowledgement flow to clear them. |
| PF14 | **Launch gating** | **WORKING** | Fixed — `isLaunchReady = failCount === 0`. Static warns no longer block. |
| PF15 | Launch → phase transition → `/live` | **WORKING** | |
| PF16 | Launch failure surfaced | **WORKING** | Fixed — inline red error block. |
| PF17 | **No-MAVLink demo path** | **MISSING** | With no flight controller, `gps_fix_type = 0` and `position_source = NO_POSITION` produce 2 hard `fail` items, so launch is blocked. Correct for real flight, but there is **no simulation or override mode**, so the app cannot be demonstrated end-to-end without a live MAVLink source. |

---

## Live Rescue Screen (`/live`)

**Intent:** fly the mission — live telemetry, live annotated video, live
detections, live event log, and direct aircraft control.

| # | Item | Status | Notes |
|---|---|---|---|
| LR1 | Telemetry readouts | **WORKING** | All fields live over WS. |
| LR2 | **Attitude indicator** | **BROKEN** | The SVG widget is well built, but `roll` and `pitch` are hardcoded to `0` ([TelemetryColumn.jsx:277-279](frontend/src/components/live/TelemetryColumn.jsx#L277)) because `telemetry.py` **never parses the `ATTITUDE` message**. The artificial horizon reads perfectly level through any manoeuvre — worse than showing nothing, because it looks authoritative. |
| LR3 | Map — drone marker + heading | **WORKING** | |
| LR4 | Map — detection markers, popups | **WORKING** | |
| LR5 | Map — VIO uncertainty ring | **WORKING** | |
| LR6 | Video feed — MJPEG | **WORKING** | Verified live against the Pi RealSense stream; YOLO boxes render. |
| LR7 | Video — NO SIGNAL placeholder | **WORKING** | Distinct from HTTP-offline. |
| LR8 | Video — auto-retry with backoff | **WORKING** | 2 s to 30 s. |
| LR9 | Detections panel | **WORKING** *(display only)* | Renders correctly, but see P0 — cards churn every frame. |
| LR10 | Event timeline | **WORKING** | Auto-scroll, collapsible, severity counts. |
| LR11 | **RTL / LAND / HOLD** | **BROKEN** | `handleCmd` sets local state and clears it after 1.5 s ([TelemetryColumn.jsx:234-238](frontend/src/components/live/TelemetryColumn.jsx#L234)). **No request is made. No `POST /api/command` endpoint exists.** The button animates "Sending…" and the operator has every reason to believe the aircraft was commanded to return. This is the most dangerous defect in the codebase. |
| LR12 | **End Mission control** | **MISSING** | `POST /api/mission/end` works and is well implemented, but nothing in the UI calls it. The operator cannot end a mission or reach a locked post-mission state from the app. |
| LR13 | Path to Analysis | **PARTIAL** | Only via the nav link, which bypasses the phase transition — so phase stays `LIVE_RESCUE` and stats stay a live snapshot. |

---

## Analysis Screen (`/analysis`)

**Intent:** review the completed mission — flight path, coverage, and triage of
every detection found.

| # | Item | Status | Notes |
|---|---|---|---|
| AN1 | Stats strip | **WORKING** *(mechanically)* | Self-fetches, 10 s refresh, error and retry. Values are wrong for the reasons below. |
| AN2 | Phase badge | **PARTIAL** | Hardcoded `<span>ANALYSIS</span>` at [StatsStrip.jsx:133](frontend/src/components/analysis/StatsStrip.jsx#L133) — ignores `telemetry.phase`. |
| AN3 | **Flight path polyline** | **BROKEN** | `pathRef` is local to `AnalysisScreen` ([AnalysisScreen.jsx:50](frontend/src/screens/AnalysisScreen.jsx#L50)) and only accumulates **while that screen is mounted**. During the actual flight the operator is on `/live`, so the path is empty when they arrive. The backend *does* keep `_position_history` ([state.py:98](backend/app/state.py#L98)) but **never exposes it** — it is absent from `get_state()` and has no endpoint. The real path exists and is unreachable. |
| AN4 | Coverage corridor | **PARTIAL** | The geometry is fine and honestly labelled, but it is derived from the broken `flightPath`, so it renders near-empty. |
| AN5 | Detection markers + click | **WORKING** | |
| AN6 | Search polygon | **WORKING** | |
| AN7 | TargetDetailPanel slide-in | **WORKING** | |
| AN8 | Confirm / Reject | **BROKEN** | API call is correct; the write is erased by the next inference frame. See P0. |
| AN9 | Adjust Priority | **BROKEN** | Same cause. |
| AN10 | Analyst notes | **BROKEN** | Same cause — notes are lost within ~100 ms. |
| AN11 | RGB snapshot | **PARTIAL** *(honest)* | Correctly labelled "not implemented"; shows no fake image. Good practice. |
| AN12 | 3D Reconstruction, Thermal Map | **WORKING** *(honest stubs)* | Clearly marked "concept only". |
| AN13 | Coverage Map tool | **PARTIAL** | Same `flightPath` dependency as AN3. |
| AN14 | Hazard Map | **WORKING** | Filters events by severity. |
| AN15 | Flight Replay | **PARTIAL** | The slider steps through `flightPath` and prints coordinates, but **does not move the map marker**, so it reads as a data table rather than a replay. Also inherits AN3. |
| AN16 | Export JSON | **WORKING** | Real blob download of `{detections, flight_path, events}`. |
| AN17 | Generate Report | **WORKING** | Navigates to `/report`. |
| AN18 | End Mission entry point | **MISSING** | Same gap as LR12. |

---

## Report Screen (`/report`)

**Intent:** a defensible, explainable post-mission ranking that a rescue
coordinator can act on.

| # | Item | Status | Notes |
|---|---|---|---|
| RP1 | Fetch `/api/report` | **WORKING** | Loading, error and retry states all correct. |
| RP2 | Header, tier badge, golden-hour timer | **WORKING** | 72 h countdown, amber < 48 h, red < 24 h. |
| RP3 | Top actions list | **WORKING** | |
| RP4 | Ranked findings table | **WORKING** | Sticky header, score bars, expandable rows. |
| RP5 | Justification strings | **WORKING** | Genuinely template-assembled from real values, every clause gated on data availability. No LLM, no invented facts. This is the strongest part of the backend. |
| RP6 | Score component transparency | **WORKING** | Shows the weighted breakdown with actual numbers. |
| RP7 | CSV export | **WORKING** | Real RFC 4180 escaping, 14 columns. |
| RP8 | PDF / GeoJSON / KML | **WORKING** *(honest stubs)* | Refuses to fake a download. |
| RP9 | Zero-detection report | **PARTIAL** | `overallTier` falls through to `"LOW"` with 0 detections ([ReportHeader.jsx:128](frontend/src/components/report/ReportHeader.jsx#L128)) — should be a neutral `N/A`. |
| RP10 | Refresh | **WORKING** | |
| RP11 | **Ranking inputs are degraded** | **BROKEN** | The formula is sound but two of its three terms are inert in practice: the age score is always ~0 (P0), and the proximity score is 0 whenever a detection has no lat/lon — which is *every* detection without MAVLink. The 4-tier system collapses to `0.5 x confidence`, capping every score at 0.5, so nothing can ever exceed **MEDIUM**. |
| RP12 | Docstring / code mismatch | **PARTIAL** | [report.py:26](backend/app/report.py#L26) says top-3 actions come from "URGENT/HIGH detections"; the code takes the top 3 of *any* tier ([report.py:282](backend/app/report.py#L282)). |

---

## Detection & Geolocation Pipeline

| # | Item | Status | Notes |
|---|---|---|---|
| D1 | YOLOv8n person inference | **WORKING** | Every 3rd frame, `classes=[0]`. Verified live. |
| D2 | Annotated MJPEG output | **WORKING** | |
| D3 | Camera reconnect | **WORKING** | Re-opens the capture every ~3 s after failure. |
| D4 | **Altitude reference is wrong** | **BROKEN** | `estimate_detection_location()` treats `drone_alt` as **height above ground**, but telemetry populates `altitude` from `GLOBAL_POSITION_INT.alt` — which is **MSL**, not AGL ([telemetry.py:79](backend/app/telemetry.py#L79)). `relative_alt` is the correct field and is ignored. On terrain 200 m above sea level, every detection is projected as if the drone were 200 m higher, scaling the ground offset by the same factor. `VFR_HUD.alt` ([telemetry.py:83](backend/app/telemetry.py#L83)) is also MSL and overwrites it. |
| D5 | **Camera model assumes nadir + 60° HFOV** | **PARTIAL** | Hardcoded `hfov_deg = 60.0` and a straight-down assumption ([detection.py:21](backend/app/detection.py#L21)). The RealSense D435 colour HFOV is about **69°** (D455 about 90°), and a forward-facing mount breaks the nadir assumption entirely. Neither gimbal pitch nor the real intrinsics are used — and the SDK exposes exact intrinsics for free. |
| D6 | No detection tracking / dedup | **MISSING** | See P0. |
| D7 | Confidence to priority thresholds | **PARTIAL** | `> 0.9` high, `> 0.7` medium, else low. YOLO's default `conf=0.25` is left unset, so 0.25-confidence noise enters the list as "low priority" survivors. |

---

## Telemetry Ingestion

| # | Item | Status | Notes |
|---|---|---|---|
| T1 | MAVLink connect + auto-retry | **WORKING** | 5 s backoff, distinguishes first-connect from reconnect. |
| T2 | Position, battery, mode, GPS parsing | **WORKING** | |
| T3 | GNSS-loss to VIO fallback events | **WORKING** | |
| T4 | **GNSS outage statistic is always 0** | **BROKEN** | `compute_mission_stats()` opens an outage window on a message containing **`"degraded"`** ([state.py:229](backend/app/state.py#L229)), but the only message ever emitted is `"GNSS signal lost — VIO fallback engaged"` ([telemetry.py:108](backend/app/telemetry.py#L108)). The substring never matches, so `gnss_outage_seconds` is **permanently `0.0`** and the Analysis strip reports a clean GNSS record for a mission that lost fix repeatedly. VIO usage, keyed on `"vio"`, works correctly. |
| T5 | `ATTITUDE` not parsed | **BROKEN** | Root cause of LR2. |
| T6 | Invalid battery reads as 0 % | **PARTIAL** | `max(0, msg.battery_remaining)` maps the MAVLink "unknown" sentinel `-1` to `0` ([telemetry.py:87](backend/app/telemetry.py#L87)), which the checklist then treats as a critically flat battery rather than missing data. The `voltage_battery` sentinel `65535` is likewise unfiltered and would display as 65.5 V. |

---

## Backend Endpoints

| Endpoint | Status | Notes |
|---|---|---|
| `GET /health` | **WORKING** | Liveness only — reports nothing about MAVLink, camera or model state. |
| `GET /api/telemetry` | **WORKING** | |
| `GET /api/video_feed` | **WORKING** | |
| `GET /api/detections` | **WORKING** | Returns the current frame's list. |
| `POST /api/mission/phase` | **WORKING** | |
| `POST /api/mission/end` | **WORKING** | Well implemented — and unreachable from the UI. |
| `GET /api/mission/stats` | **PARTIAL** | Mechanically correct; `detection_count` and `gnss_outage_seconds` are wrong (P0, T4). |
| `POST /api/detections/{id}/review` | **BROKEN** | Correct logic, erased by the next frame. |
| `GET /api/report` | **PARTIAL** | Correct engine, degraded inputs. |
| `POST /api/command` | **MISSING** | RTL / LAND / HOLD have no backend. |
| `POST /api/mission` (metadata) | **MISSING** | PF2 has nothing to call. |
| `PUT /api/mission/geometry` | **MISSING** | PF4 edits have nowhere to persist. |
| `GET /api/flight_path` | **MISSING** | AN3 has no source for the real path. |
| CORS | **PARTIAL** | Locked to localhost. Correct for now; blocks serving the GCS from a second machine. |

---

## Prioritised Fix List

### P0 — Blocks the core product claim

| # | Item | Why it matters |
|---|---|---|
| 1 | **Detection accumulation + stable track IDs** | Without it there is no mission record. The report, the stats, and the entire review workflow describe one video frame. Fixes AN8/AN9/AN10, RP11 and `detection_count` in one change. |
| 2 | **Wire RTL / LAND / HOLD, or visibly disable them** | The UI claims aircraft control it does not have. If the backend is out of scope, the buttons must be disabled with an explicit "not wired" label — the same honesty already applied to the PDF/GeoJSON stubs. |
| 3 | **End Mission control** | No UI path exists to the post-mission state the whole Analysis/Report flow assumes. |
| 4 | **Use `relative_alt` for geolocation** | Detection coordinates are currently scaled by terrain elevation. A one-field change that makes every coordinate in the report defensible. |

### P1 — Materially wrong output

| # | Item |
|---|---|
| 5 | Expose `_position_history` via an endpoint; stop rebuilding `flightPath` in the Analysis screen (AN3, AN4, AN13, AN15) |
| 6 | Fix the GNSS-outage substring match — `"degraded"` vs `"lost"` (T4) |
| 7 | Parse `ATTITUDE` so the artificial horizon is real, or hide the widget (LR2) |
| 8 | Persist Pre-Flight map edits to the backend (PF4) |
| 9 | Recompute map stats from actual waypoints instead of the hardcoded literal (PF5) |
| 10 | Use the RealSense intrinsics and true HFOV instead of the hardcoded 60° nadir model (D5) |
| 11 | Wire `videoSignal` into the "Video downlink" checklist item — the data is already in context (PF10) |
| 12 | Set an explicit YOLO confidence floor; 0.25 noise currently enters the survivor list (D7) |
| 13 | Cap `events` and `_position_history` growth (G9) |
| 14 | Handle the `-1` / `65535` MAVLink invalid-value sentinels (T6) |

### P2 — Polish and completeness

| # | Item |
|---|---|
| 15 | StatsStrip phase badge reads `telemetry.phase` instead of the literal "ANALYSIS" (AN2) |
| 16 | Report tier shows `N/A` rather than `LOW` for zero detections (RP9) |
| 17 | Flight Replay moves the map marker (AN15) |
| 18 | Implement or remove "Edit Mission Parameters" (PF2) |
| 19 | Operator acknowledgement toggles for the static checklist warns (PF8, PF11, PF13) |
| 20 | A simulation / demo mode so the app runs without MAVLink (PF17) |
| 21 | `/health` reports MAVLink, camera and model status (PF12) |
| 22 | Move the API base URL to `import.meta.env` (G11) |
| 23 | Fix `start.ps1` — `$IsWindows` is undefined in PowerShell 5.1 (G8) |
| 24 | Reconcile the `report.py` top-3 docstring with the code (RP12) |
| 25 | Persist state to disk/DB so a restart does not erase the mission (G10) |

---

## What Is Genuinely Good

Worth preserving as the codebase changes:

- **The ranking engine** ([report.py](backend/app/report.py)) — a documented linear
  formula with per-component transparency and no invented facts. Fix its inputs
  and it is production-quality.
- **Honest placeholders.** "Not available in this build" on PDF/GeoJSON/KML and
  the missing-snapshot panel, instead of fake data. Rare discipline.
- **The reconnection logic** on both the WebSocket and the video feed — proper
  exponential backoff with user-visible countdowns.
- **The Pre-Flight Position and Power checks** — real MAVLink signals, sensible
  thresholds, correct pass/warn/fail tiers.

---

_Audit completed 2026-09-12 against the working tree. No source files were modified._
