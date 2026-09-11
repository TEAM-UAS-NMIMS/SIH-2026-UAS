/**
 * MapPanel — self-contained react-leaflet map for the Live Rescue screen.
 *
 * Props (all external, no context access from inside this file):
 *   droneLat        number   — drone latitude  (0 = no fix yet)
 *   droneLon        number   — drone longitude (0 = no fix yet)
 *   droneHeading    number   — heading in degrees (0–360)
 *   positionSource  string   — "GNSS" | "VIO_FALLBACK" | "NO_POSITION"
 *   detections      Array<{
 *     id, label, confidence, priority,
 *     lat, lon, position_source, uncertainty_m
 *   }>
 *
 * Behaviour:
 *  - On the first frame that a valid drone position arrives (lat/lon ≠ 0),
 *    the map flies to that position at zoom 17 — once only.
 *    After that the user can freely pan/zoom; no snap-back occurs.
 *  - Drone marker is a rotated helicopter emoji, heading-aligned.
 *  - VIO_FALLBACK adds a dashed amber circle (radius = 12 m, not filled)
 *    around the drone to signal position uncertainty.
 *  - Detection markers are coloured by priority; clicking opens a popup
 *    with id, confidence, coordinates, position source, and uncertainty.
 *
 * This file imports ONLY react, react-leaflet, and leaflet.
 * It does NOT import TelemetryColumn, FeedAndTimeline, DetectionsPanel,
 * StatusBar, TelemetryContext, or any other project file.
 */

import { useRef, useEffect, useMemo, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Circle,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import MapAutoResize from "../MapAutoResize";
import Icon from "../Icon";
import { iconMarkup } from "../icons";

// ─── Leaflet icon fix (bundler path issue) ────────────────────────────────────
// Safe to call multiple times; mergeOptions is idempotent.
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl:       "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl:     "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

// ─── Icon factories ───────────────────────────────────────────────────────────

/**
 * Rotated helicopter emoji as the drone marker.
 * heading = 0 → nose pointing north.
 */
function makeDroneIcon(heading) {
  return L.divIcon({
    className: "",
    html: `
      <div style="
        width: 28px; height: 28px;
        transform: rotate(${heading}deg);
        display: flex; align-items: center; justify-content: center;
        color: #0f172a;
        filter: drop-shadow(0 1px 4px rgba(255,255,255,.95));
        user-select: none;
      ">${iconMarkup("drone", { size: 22, strokeWidth: 2.25 })}</div>`,
    iconAnchor:  [14, 14],
    popupAnchor: [0, -16],
  });
}

/** Priority → fill colour. */
const PRIORITY_COLOR = {
  high:   "#B0201A",   // red-600
  medium: "#8A5A00",   // amber-600
  low:    "#111111",   // nominal
};

/**
 * Coloured dot marker for detections.
 * size = diameter in px.
 */
function makeDetectionIcon(priority, size = 14) {
  const color = PRIORITY_COLOR[priority] ?? "#64748b"; // slate-500 fallback
  return L.divIcon({
    className: "",
    html: `
      <div style="
        width: ${size}px; height: ${size}px;
        border-radius: 50%;
        background: ${color};
        border: 2.5px solid white;
        box-shadow: 0 0 0 1.5px ${color}80, 0 1px 4px rgba(0,0,0,.35);
      "></div>`,
    iconAnchor:  [size / 2, size / 2],
    popupAnchor: [0, -(size / 2 + 6)],
  });
}

// ─── One-shot initial centering ───────────────────────────────────────────────
/**
 * Flies the map to [lat, lon] at zoom 17 exactly once — the first time a
 * valid fix (lat ≠ 0, lon ≠ 0) arrives.  After that initial fly-to the
 * component is inert; the user can pan/zoom freely and the map never snaps back.
 */
function FollowAircraft({ lat, lon, follow, onUserPan }) {
  const map = useMap();
  const zoomedIn = useRef(false);
  const programmatic = useRef(false);

  const hasFix = lat !== 0 && lon !== 0;

  // First valid fix: jump straight to survey zoom. Deliberately NOT animated —
  // an animated flyTo is cancelled by the next telemetry tick's panTo, which
  // left the map stranded at world zoom showing the wrong continent.
  useEffect(() => {
    if (zoomedIn.current || !hasFix) return;
    programmatic.current = true;
    map.setView([lat, lon], 17, { animate: false });
    zoomedIn.current = true;
    const t = setTimeout(() => { programmatic.current = false; }, 120);
    return () => clearTimeout(t);
  }, [hasFix, lat, lon, map]);

  // Afterwards keep the aircraft in view. At survey speed it leaves a zoom-17
  // viewport within seconds, so a map that only centres once shows empty
  // ground for most of the mission.
  useEffect(() => {
    if (!zoomedIn.current || !follow || !hasFix) return;
    programmatic.current = true;
    map.panTo([lat, lon], { animate: true, duration: 0.3 });
    const t = setTimeout(() => { programmatic.current = false; }, 380);
    return () => clearTimeout(t);
  }, [lat, lon, follow, hasFix, map]);

  // Re-centre immediately when the operator re-arms Follow.
  useEffect(() => {
    if (follow && zoomedIn.current && hasFix) {
      programmatic.current = true;
      map.setView([lat, lon], Math.max(map.getZoom(), 16), { animate: false });
      setTimeout(() => { programmatic.current = false; }, 120);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [follow]);

  // A manual pan or zoom releases follow, so the operator can inspect the map
  // without it yanking back. Re-arm with the Follow control.
  useMapEvents({
    dragstart() { if (!programmatic.current) onUserPan(); },
    zoomstart() { if (!programmatic.current) onUserPan(); },
  });

  return null;
}

// ─── Detection marker + popup ─────────────────────────────────────────────────

function DetectionMarker({ det }) {
  // Only render if the detection has a position estimate.
  if (det.lat == null || det.lon == null) return null;

  const conf   = (det.confidence * 100).toFixed(1);
  const source = det.position_source?.replace(/_/g, " ") ?? "NO POSITION";
  const icon   = useMemo(
    () => makeDetectionIcon(det.priority),
    [det.priority]
  );

  return (
    <Marker position={[det.lat, det.lon]} icon={icon}>
      <Popup maxWidth={220}>
        <div style={{ fontFamily: "Inter, sans-serif", fontSize: 12, lineHeight: 1.6 }}>
          {/* Label + priority */}
          <div style={{ fontWeight: 700, textTransform: "capitalize", marginBottom: 4, display: "inline-flex", alignItems: "center", gap: 4 }}>
            <Icon name="user" size={13} /> {det.label}
            {" "}
            <span style={{
              display: "inline-block",
              padding: "1px 6px",
              borderRadius: 999,
              fontSize: 10,
              fontWeight: 700,
              background:
                det.priority === "high"   ? "#fee2e2" :
                det.priority === "medium" ? "#fef3c7" : "#dcfce7",
              color:
                det.priority === "high"   ? "#B0201A" :
                det.priority === "medium" ? "#8A5A00" : "#111111",
            }}>
              {det.priority}
            </span>
          </div>

          {/* Confidence */}
          <div><span style={{ color: "#94a3b8" }}>Confidence</span> {conf}%</div>

          {/* Coordinates */}
          <div style={{ fontFamily: "monospace", fontSize: 11, marginTop: 2 }}>
            {det.lat.toFixed(6)}, {det.lon.toFixed(6)}
          </div>

          {/* Position source */}
          <div style={{ marginTop: 2 }}>
            <span style={{ color: "#94a3b8" }}>Source</span> {source}
          </div>

          {/* Uncertainty */}
          {det.uncertainty_m != null && (
            <div>
              <span style={{ color: "#94a3b8" }}>Uncertainty</span>{" "}
              ±{det.uncertainty_m.toFixed(1)} m
            </div>
          )}

          {/* Detection ID */}
          <div style={{ marginTop: 4, fontSize: 9, color: "#cbd5e1", wordBreak: "break-all" }}>
            {det.id}
          </div>
        </div>
      </Popup>
    </Marker>
  );
}

// ─── MapPanel ─────────────────────────────────────────────────────────────────

// NMIMS Shirpur campus — the configured mission area. Used until the first
// GPS fix arrives; zoom 16 shows the whole search box rather than the globe.
const DEFAULT_CENTER = [21.3486, 74.8800];
const DEFAULT_ZOOM   = 16;

export default function MapPanel({
  droneLat       = 0,
  droneLon       = 0,
  droneHeading   = 0,
  positionSource = "NO_POSITION",
  detections     = [],
}) {
  const hasPosition = droneLat !== 0 || droneLon !== 0;
  const [follow, setFollow] = useState(true);
  const isVio       = positionSource === "VIO_FALLBACK";

  // Drone icon is recreated whenever heading changes, but that's fine —
  // Leaflet diffing skips DOM patches if the element is the same element.
  const droneIcon = useMemo(
    () => makeDroneIcon(Number.isFinite(droneHeading) ? droneHeading : 0),
    [droneHeading],
  );

  return (
    <div className="panel overflow-hidden flex flex-col h-full" style={{ minHeight: 0 }}>
      {/* ── Header bar ── */}
      <div className="panel-head">
        <h2 className="text-xs font-bold text-[var(--ink-2)] uppercase tracking-widest">
          Live Map
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFollow((f) => !f)}
            className="pill"
            style={follow
              ? { background: "var(--ink)", borderColor: "var(--ink)", color: "#fff" }
              : undefined}
            title={follow
              ? "Map is tracking the aircraft — click to unlock and pan freely"
              : "Map is unlocked — click to re-centre and track the aircraft"}
          >
            {follow ? "Following" : "Follow"}
          </button>
          {isVio && (
            <span className="pill-amber text-[10px]">VIO — position uncertain</span>
          )}
          {positionSource === "NO_POSITION" && (
            <span className="pill-slate text-[10px]">No GPS fix</span>
          )}
          <span className="text-[10px] text-[var(--ink-3)] font-mono">OpenStreetMap</span>
        </div>
      </div>

      {/* ── Map ── */}
      <div className="flex-1 min-h-0">
        <MapContainer
          center={DEFAULT_CENTER}
          zoom={DEFAULT_ZOOM}
          style={{ width: "100%", height: "100%" }}
          zoomControl
          scrollWheelZoom
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {/* Keeps Leaflet's measured size in step with its flex container */}
          <MapAutoResize />

          {/* Keeps the aircraft in view; releases on manual pan/zoom */}
          <FollowAircraft
            lat={droneLat}
            lon={droneLon}
            follow={follow}
            onUserPan={() => setFollow(false)}
          />

          {/* ── Drone marker ── */}
          {hasPosition && (
            <>
              <Marker
                position={[droneLat, droneLon]}
                icon={droneIcon}
                zIndexOffset={1000}   // always above detection dots
              >
                <Popup maxWidth={180}>
                  <div style={{ fontFamily: "Inter, sans-serif", fontSize: 12, lineHeight: 1.6 }}>
                    <div style={{ fontWeight: 700, marginBottom: 4, display: "flex", alignItems: "center", gap: 4 }}>
                      <Icon name="drone" size={13} /> Drone
                    </div>
                    <div style={{ fontFamily: "monospace", fontSize: 11 }}>
                      {droneLat.toFixed(6)}, {droneLon.toFixed(6)}
                    </div>
                    <div>
                      <span style={{ color: "#94a3b8" }}>Heading</span>{" "}
                      {Number.isFinite(droneHeading) ? `${droneHeading.toFixed(0)}°` : "——"}
                    </div>
                    <div>
                      <span style={{ color: "#94a3b8" }}>Source</span>{" "}
                      {positionSource.replace(/_/g, " ")}
                    </div>
                  </div>
                </Popup>
              </Marker>

              {/* VIO uncertainty ring — dashed amber outline, NOT filled */}
              {isVio && (
                <Circle
                  center={[droneLat, droneLon]}
                  radius={12}
                  pathOptions={{
                    color:       "#8A5A00",  // caution
                    weight:      2,
                    fill:        false,
                    dashArray:   "6 4",
                  }}
                />
              )}
            </>
          )}

          {/* ── Detection markers ── */}
          {detections.map((det) => (
            <DetectionMarker key={det.id} det={det} />
          ))}
        </MapContainer>
      </div>

      {/* ── Footer legend ── */}
      <div className="px-3 py-1.5 flex items-center gap-3 flex-wrap shrink-0" style={{ borderTop: "1px solid var(--rule)", background: "var(--surface-2)" }}>
        <LegendItem icon="drone" label="Drone" />
        <LegendDot color="#B0201A" label="High priority" />
        <LegendDot color="#8A5A00" label="Medium priority" />
        <LegendDot color="#111111" label="Low priority" />
        {isVio && <LegendVio />}
      </div>
    </div>
  );
}

// ─── Legend helpers ───────────────────────────────────────────────────────────

function LegendItem({ icon, label }) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon name={icon} size={15} className="text-[var(--ink-2)]" />
      <span className="text-[10px] text-[var(--ink-3)] font-medium">{label}</span>
    </div>
  );
}

function LegendDot({ color, label }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        style={{
          display: "inline-block",
          width: 8, height: 8,
          borderRadius: "50%",
          background: color,
          border: "1.5px solid white",
          boxShadow: `0 0 0 1px ${color}`,
        }}
      />
      <span className="text-[10px] text-[var(--ink-3)] font-medium">{label}</span>
    </div>
  );
}

function LegendVio() {
  return (
    <div className="flex items-center gap-1.5">
      <svg width="16" height="10" viewBox="0 0 16 10">
        <line
          x1="0" y1="5" x2="16" y2="5"
          stroke="#8A5A00" strokeWidth="2" strokeDasharray="4 2"
        />
      </svg>
      <span className="text-[10px] text-amber-600 font-medium">VIO uncertainty</span>
    </div>
  );
}
