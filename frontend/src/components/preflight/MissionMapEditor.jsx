/**
 * MissionMapEditor — draw the sortie: search area, geofence and flight route.
 *
 * One edit mode is active at a time, because three overlapping editable
 * polygons on one map with no mode is unusable: a click is ambiguous and the
 * operator cannot tell what they are about to change. The active layer is drawn
 * solid with draggable vertices; the others stay visible but inert.
 *
 *   Route     click to append a waypoint; drag to move; click a marker to delete
 *   Search    the area to be swept — drag vertices, click the map to add one
 *   Geofence  the hard boundary the aircraft may not cross, with shape presets
 *
 * Every change is handed up and persisted server-side, so the plan survives
 * navigation and can be uploaded to the autopilot.
 */
import { useMemo, useState, useCallback } from "react";
import {
  MapContainer, TileLayer, Marker, Popup, Polyline, Polygon, useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import MapAutoResize from "../MapAutoResize";
import Icon from "../Icon";
import StatusPill from "../StatusPill";
import { iconMarkup } from "../icons";

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl:       "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl:     "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const MODES = [
  { id: "route",    label: "Route",    hint: "Click the map to append a waypoint; drag to move; click a marker to delete" },
  { id: "search",   label: "Search",   hint: "Drag vertices to reshape the area to be swept; click the map to add a vertex" },
  { id: "geofence", label: "Geofence", hint: "Drag vertices to reshape the hard boundary the aircraft may not cross" },
];

function waypointIcon(index, active) {
  return L.divIcon({
    className: "",
    html: `<div style="
      width:20px;height:20px;border-radius:50%;
      background:${active ? "#111" : "#8C8C8C"};color:#fff;
      display:flex;align-items:center;justify-content:center;
      font:600 10px/1 'IBM Plex Mono',monospace;
      border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.25);
    ">${index + 1}</div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

function vertexIcon(active) {
  return L.divIcon({
    className: "",
    html: `<div style="
      width:11px;height:11px;
      background:${active ? "#111" : "#B0B0B0"};
      border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.3);
    "></div>`,
    iconSize: [11, 11],
    iconAnchor: [5.5, 5.5],
  });
}

const homeIcon = L.divIcon({
  className: "",
  html: `<div style="color:#111;line-height:0;filter:drop-shadow(0 1px 2px rgba(255,255,255,.95));">${
    iconMarkup("home", { size: 20, strokeWidth: 2.25 })
  }</div>`,
  iconAnchor: [10, 18],
});

/** Click-to-add, scoped to whichever layer is being edited. */
function MapClickHandler({ mode, onAdd }) {
  useMapEvents({
    click(e) {
      if (!mode) return;
      onAdd([e.latlng.lat, e.latlng.lng]);
    },
  });
  return null;
}

/** Insert a point into a polygon at the edge nearest to it, not at the end. */
function insertAtNearestEdge(poly, point) {
  if (poly.length < 2) return [...poly, point];
  let best = poly.length, bestDist = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    const d = (mx - point[0]) ** 2 + (my - point[1]) ** 2;
    if (d < bestDist) { bestDist = d; best = i + 1; }
  }
  const next = [...poly];
  next.splice(best, 0, point);
  return next;
}

/** Axis-aligned box around a set of points, expanded by a margin in metres. */
function boxAround(points, marginM = 60) {
  if (!points.length) return [];
  const lats = points.map((p) => p[0]);
  const lons = points.map((p) => p[1]);
  const dLat = marginM / 111111;
  const midLat = (Math.max(...lats) + Math.min(...lats)) / 2;
  const dLon = marginM / (111111 * Math.cos((midLat * Math.PI) / 180));
  const [s, n] = [Math.min(...lats) - dLat, Math.max(...lats) + dLat];
  const [w, e] = [Math.min(...lons) - dLon, Math.max(...lons) + dLon];
  return [[n, w], [n, e], [s, e], [s, w]];
}

export default function MissionMapEditor({
  mapData,
  onWaypointsChange,
  onPolygonChange,
  onGeofenceChange,
  saveState,
}) {
  const { launchPoint, waypoints = [], searchPolygon = [], geofence = [], hazardZone = [], stats = {} } = mapData;
  const [mode, setMode] = useState("route");

  const center = useMemo(
    () => launchPoint ?? searchPolygon[0] ?? [21.3486, 74.88],
    [launchPoint, searchPolygon],
  );

  const handleAdd = useCallback((pt) => {
    if (mode === "route")    onWaypointsChange([...waypoints, pt]);
    if (mode === "search")   onPolygonChange(insertAtNearestEdge(searchPolygon, pt));
    if (mode === "geofence") onGeofenceChange(insertAtNearestEdge(geofence, pt));
  }, [mode, waypoints, searchPolygon, geofence,
      onWaypointsChange, onPolygonChange, onGeofenceChange]);

  const moveVertex = (list, i, latlng, cb) => {
    const next = [...list];
    next[i] = [latlng.lat, latlng.lng];
    cb(next);
  };

  const activeMode = MODES.find((m) => m.id === mode);

  return (
    <div className="panel flex flex-col h-full overflow-hidden">
      {/* ── Toolbar ── */}
      <div className="panel-head">
        <div className="flex items-center gap-2.5">
          <h2 className="panel-title whitespace-nowrap">Mission Planner</h2>
          <div className="flex gap-1">
            {MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                title={m.hint}
                className="pill"
                style={mode === m.id
                  ? { background: "var(--ink)", borderColor: "var(--ink)", color: "#fff" }
                  : undefined}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {mode === "geofence" && (
            <>
              <button className="pill" title="Generate a boundary box 60 m outside the search area"
                      onClick={() => onGeofenceChange(boxAround(searchPolygon, 60))}>
                Fit to search
              </button>
              <button className="pill" title="Remove the geofence"
                      onClick={() => onGeofenceChange([])}>
                Clear
              </button>
            </>
          )}
          {mode === "route" && waypoints.length > 0 && (
            <button className="pill" onClick={() => onWaypointsChange([])}>
              Clear route
            </button>
          )}
          {saveState === "saving" && <StatusPill tone="absent" label="Saving…" />}
          {saveState === "saved"  && <StatusPill tone="nominal" label="Plan saved" dot />}
          {saveState && !["saving", "saved"].includes(saveState) && (
            <StatusPill tone="critical" label="Not saved" dot title={saveState} />
          )}
        </div>
      </div>

      {/* Mode hint — tells the operator what a click will do. */}
      <div className="px-3 py-1.5 text-[10.5px] shrink-0"
           style={{ background: "var(--surface-2)", borderBottom: "1px solid var(--rule)",
                    color: "var(--ink-2)" }}>
        {activeMode?.hint}
      </div>

      {/* ── Map ── */}
      <div className="flex-1 min-h-0">
        <MapContainer center={center} zoom={16} style={{ width: "100%", height: "100%" }}
                      scrollWheelZoom>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <MapAutoResize />
          <MapClickHandler mode={mode} onAdd={handleAdd} />

          {/* Geofence — the hard boundary */}
          {geofence.length >= 3 && (
            <Polygon
              positions={geofence}
              pathOptions={{
                color: mode === "geofence" ? "#111111" : "#9A9A9A",
                weight: mode === "geofence" ? 2.5 : 1.5,
                dashArray: "2 6",
                fill: false,
              }}
            />
          )}

          {/* Search area — what gets swept */}
          {searchPolygon.length >= 3 && (
            <Polygon
              positions={searchPolygon}
              pathOptions={{
                color: mode === "search" ? "#111111" : "#9A9A9A",
                weight: mode === "search" ? 2.5 : 1.5,
                dashArray: "8 5",
                fillOpacity: mode === "search" ? 0.06 : 0.02,
                fillColor: "#111111",
              }}
            />
          )}

          {/* Hazard zone — read-only, always the one coloured thing */}
          {hazardZone.length >= 3 && (
            <Polygon
              positions={hazardZone}
              pathOptions={{ color: "#B0201A", weight: 2, dashArray: "5 4",
                             fillColor: "#B0201A", fillOpacity: 0.08 }}
            >
              <Popup><strong>Hazard zone</strong><br />Read-only — set by incident command</Popup>
            </Polygon>
          )}

          {/* Route */}
          {waypoints.length >= 2 && (
            <Polyline
              positions={waypoints}
              pathOptions={{ color: mode === "route" ? "#111111" : "#9A9A9A",
                             weight: 2, dashArray: "6 4" }}
            />
          )}

          {launchPoint && (
            <Marker position={launchPoint} icon={homeIcon}>
              <Popup>
                <strong>Launch point</strong><br />
                {launchPoint[0].toFixed(6)}, {launchPoint[1].toFixed(6)}
              </Popup>
            </Marker>
          )}

          {waypoints.map((pos, i) => (
            <Marker
              key={`wp-${i}`}
              position={pos}
              icon={waypointIcon(i, mode === "route")}
              draggable={mode === "route"}
              eventHandlers={{
                dragend: (e) => moveVertex(waypoints, i, e.target.getLatLng(), onWaypointsChange),
                click: () => {
                  if (mode !== "route") return;
                  onWaypointsChange(waypoints.filter((_, j) => j !== i));
                },
              }}
            >
              <Popup>
                <strong>Waypoint {i + 1}</strong><br />
                {pos[0].toFixed(6)}, {pos[1].toFixed(6)}<br />
                <em>Click the marker to remove</em>
              </Popup>
            </Marker>
          ))}

          {mode === "search" && searchPolygon.map((pos, i) => (
            <Marker
              key={`sp-${i}`}
              position={pos}
              icon={vertexIcon(true)}
              draggable
              eventHandlers={{
                dragend: (e) => moveVertex(searchPolygon, i, e.target.getLatLng(), onPolygonChange),
                click: () => {
                  if (searchPolygon.length <= 3) return;   // keep it a polygon
                  onPolygonChange(searchPolygon.filter((_, j) => j !== i));
                },
              }}
            />
          ))}

          {mode === "geofence" && geofence.map((pos, i) => (
            <Marker
              key={`gf-${i}`}
              position={pos}
              icon={vertexIcon(true)}
              draggable
              eventHandlers={{
                dragend: (e) => moveVertex(geofence, i, e.target.getLatLng(), onGeofenceChange),
                click: () => {
                  if (geofence.length <= 3) return;
                  onGeofenceChange(geofence.filter((_, j) => j !== i));
                },
              }}
            />
          ))}
        </MapContainer>
      </div>

      {/* ── Legend ── */}
      <div className="px-3 py-1.5 flex items-center gap-3 flex-wrap shrink-0 text-[10px]"
           style={{ borderTop: "1px solid var(--rule)", background: "var(--surface-2)",
                    color: "var(--ink-3)" }}>
        <span>— — Search area</span>
        <span>· · · Geofence</span>
        <span style={{ color: "var(--critical)" }}>— — Hazard zone</span>
        <span>◦ Route</span>
        <span className="ml-auto flex items-center gap-1">
          <Icon name="home" size={11} /> Launch
        </span>
      </div>

      {/* ── Computed plan figures ── */}
      <div className="grid grid-cols-4 shrink-0"
           style={{ borderTop: "1px solid var(--rule)" }}>
        {[
          { v: stats.distanceKm,        u: "km",       l: "Route" },
          { v: stats.flightTimeMin,     u: "min est.", l: "Flight time" },
          { v: stats.coverageHa,        u: "ha",       l: "Search area" },
          { v: stats.batteryReservePct, u: "% at RTL", l: "Reserve" },
        ].map(({ v, u, l }) => (
          <div key={l} className="px-3 py-2 text-center"
               style={{ borderRight: "1px solid var(--rule)" }}>
            <div className="text-[15px] font-semibold tabular-nums"
                 style={{ fontFamily: '"IBM Plex Mono", monospace' }}>
              {v ?? "——"}
            </div>
            <div className="text-[9px]" style={{ color: "var(--ink-3)" }}>{u}</div>
            <div className="text-[9px] uppercase tracking-[0.1em] mt-0.5"
                 style={{ color: "var(--ink-2)" }}>{l}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
