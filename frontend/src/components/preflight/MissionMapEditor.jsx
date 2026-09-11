/**
 * MissionMapEditor — center column of PreFlightScreen.
 * Interactive editing:
 *   - Toolbar ADD WP mode: click map in ADD mode to append a waypoint
 *   - Waypoint markers are draggable; popup has a Delete button
 *   - Search polygon vertices are draggable markers
 *   - Hazard zone is read-only (red dashed)
 *
 * Props:
 *   mapData            { launchPoint, waypoints, searchPolygon, hazardZone, stats }
 *   onWaypointsChange  fn([lat,lon][])
 *   onPolygonChange    fn([lat,lon][])
 */

import { useMemo, useRef, useEffect, useState, useCallback } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  Polygon,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import Icon from "../Icon";
import { iconMarkup } from "../icons";

// Fix Leaflet default icon paths (same pattern as LiveRescueScreen)
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

// ─── Numbered waypoint icon ───────────────────────────────────────────────────

function waypointIcon(index) {
  return L.divIcon({
    className: "",
    html: `<div style="width:22px;height:22px;border-radius:50%;background:#2563eb;border:2.5px solid white;box-shadow:0 1px 4px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:white;font-family:Inter,sans-serif;cursor:grab;">${index + 1}</div>`,
    iconAnchor: [11, 11],
    popupAnchor: [0, -14],
  });
}

// ─── Polygon vertex icon ──────────────────────────────────────────────────────

function polygonVertexIcon() {
  return L.divIcon({
    className: "",
    html: `<div style="width:14px;height:14px;border-radius:50%;background:#84cc16;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,.4);cursor:grab;"></div>`,
    iconAnchor: [7, 7],
    popupAnchor: [0, -10],
  });
}

// ─── Home/launch icon ─────────────────────────────────────────────────────────

const homeIcon = L.divIcon({
  className: "",
  html: `<div style="color:#1e293b;line-height:0;filter:drop-shadow(0 1px 3px rgba(255,255,255,.9));">${iconMarkup(
    "home",
    { size: 20, strokeWidth: 2.25 },
  )}</div>`,
  iconAnchor: [10, 18],
  popupAnchor: [0, -20],
});

// ─── FitBounds on mount ───────────────────────────────────────────────────────

function FitBounds({ positions }) {
  const map = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (!fitted.current && positions.length > 0) {
      map.fitBounds(L.latLngBounds(positions), { padding: [36, 36] });
      fitted.current = true;
    }
  }, [map, positions]);
  return null;
}

// ─── Map click handler (active only in ADD mode) ──────────────────────────────

function MapClickHandler({ addMode, onMapClick }) {
  useMapEvents({
    click(e) {
      if (addMode) onMapClick([e.latlng.lat, e.latlng.lng]);
    },
  });
  return null;
}

// ─── Stat cell ────────────────────────────────────────────────────────────────

function StatCell({ label, value, sub }) {
  return (
    <div className="flex flex-col items-center gap-0.5 flex-1">
      <span className="text-base font-bold text-slate-800 tabular-nums">{value}</span>
      {sub && <span className="text-[10px] text-slate-400 font-medium">{sub}</span>}
      <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">{label}</span>
    </div>
  );
}

// ─── MissionMapEditor ─────────────────────────────────────────────────────────

export default function MissionMapEditor({ mapData, onWaypointsChange, onPolygonChange }) {
  const { launchPoint, waypoints, searchPolygon, hazardZone, stats } = mapData;
  const [addMode, setAddMode] = useState(false);

  // Initial positions for fitBounds — run once on mount only
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initialPositions = useMemo(() => [launchPoint, ...waypoints, ...searchPolygon, ...hazardZone], []);

  const routeLine = useMemo(() => [launchPoint, ...waypoints], [launchPoint, waypoints]);

  // Waypoint handlers (controlled — state lives in PreFlightScreen)
  const handleMapClick = useCallback((pos) => {
    onWaypointsChange([...waypoints, pos]);
  }, [waypoints, onWaypointsChange]);

  const handleWpDrag = useCallback((i, e) => {
    const { lat, lng } = e.target.getLatLng();
    onWaypointsChange(waypoints.map((p, idx) => idx === i ? [lat, lng] : p));
  }, [waypoints, onWaypointsChange]);

  const handleWpDelete = useCallback((i) => {
    onWaypointsChange(waypoints.filter((_, idx) => idx !== i));
  }, [waypoints, onWaypointsChange]);

  // Polygon vertex drag handler
  const handleVertexDrag = useCallback((i, e) => {
    const { lat, lng } = e.target.getLatLng();
    onPolygonChange(searchPolygon.map((p, idx) => idx === i ? [lat, lng] : p));
  }, [searchPolygon, onPolygonChange]);

  return (
    <div className="panel overflow-hidden flex flex-col h-full">
      {/* Header */}
      <div className="px-4 pt-3 pb-2.5 flex items-center justify-between shrink-0 border-b border-slate-100">
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Mission Map Editor</h2>
        <div className="flex items-center gap-2">
          {/* ADD / VIEW mode toggle */}
          <button
            onClick={() => setAddMode((m) => !m)}
            className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-widest transition-all ${
              addMode ? "bg-blue-600 text-white shadow-sm" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
            }`}
          >
            <span className="inline-flex items-center gap-1">
              <Icon name="plus" size={11} strokeWidth={3} />
              {addMode ? "Adding WP…" : "Add WP"}
            </span>
          </button>
          {waypoints.length > 0 && (
            <button
              onClick={() => { onWaypointsChange([]); setAddMode(false); }}
              className="px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-widest
                         bg-red-50 text-red-500 ring-1 ring-red-200 hover:bg-red-100 transition-all"
            >
              Clear All
            </button>
          )}
          <span className="text-[10px] text-slate-400 font-mono">{waypoints.length} WP</span>
        </div>
      </div>

      {/* ADD mode hint bar */}
      {addMode && (
        <div className="px-4 py-1.5 bg-blue-50 border-b border-blue-100 shrink-0">
          <p className="text-[10px] text-blue-600 font-semibold">
            Click anywhere on the map to place a waypoint. Click "Adding WP…" again to stop.
          </p>
        </div>
      )}

      {/* Map */}
      <div className="flex-1 min-h-0" style={{ cursor: addMode ? "crosshair" : undefined }}>
        <MapContainer center={launchPoint} zoom={14} style={{ width: "100%", height: "100%" }} zoomControl scrollWheelZoom>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FitBounds positions={initialPositions} />
          <MapClickHandler addMode={addMode} onMapClick={handleMapClick} />

          {/* Search polygon — lime outline */}
          {searchPolygon.length > 0 && (
            <Polygon positions={searchPolygon} pathOptions={{ color: "#84cc16", weight: 2, fill: false, dashArray: "6 3" }} />
          )}

          {/* Draggable polygon vertex markers */}
          {searchPolygon.map((pos, i) => (
            <Marker
              key={`poly-${i}`}
              position={pos}
              icon={polygonVertexIcon()}
              draggable
              eventHandlers={{ dragend: (e) => handleVertexDrag(i, e) }}
            >
              <Popup>
                <div className="text-xs font-mono space-y-0.5">
                  <div className="font-bold text-slate-700">Polygon vertex {i + 1}</div>
                  <div>Lat: {pos[0].toFixed(6)}</div>
                  <div>Lon: {pos[1].toFixed(6)}</div>
                  <div className="text-[10px] text-slate-400 italic">Drag to move</div>
                </div>
              </Popup>
            </Marker>
          ))}

          {/* Hazard zone — red dashed outline, read-only */}
          {hazardZone.length > 0 && (
            <Polygon positions={hazardZone} pathOptions={{ color: "#dc2626", weight: 2, fill: false, dashArray: "4 4" }} />
          )}

          {/* Route line */}
          {routeLine.length > 1 && (
            <Polyline positions={routeLine} pathOptions={{ color: "#2563eb", weight: 2, opacity: 0.6, dashArray: "8 4" }} />
          )}

          {/* Launch / home point — not draggable */}
          <Marker position={launchPoint} icon={homeIcon}>
            <Popup>
              <div className="text-xs font-mono space-y-0.5">
                <div className="font-bold text-slate-700 flex items-center gap-1">
                  <Icon name="home" size={12} /> Launch Point
                </div>
                <div>Lat: {launchPoint[0].toFixed(6)}</div>
                <div>Lon: {launchPoint[1].toFixed(6)}</div>
              </div>
            </Popup>
          </Marker>

          {/* Waypoints — draggable; popup has Delete button */}
          {waypoints.map((pos, i) => (
            <Marker
              key={`wp-${i}-${pos[0].toFixed(5)}`}
              position={pos}
              icon={waypointIcon(i)}
              draggable
              eventHandlers={{ dragend: (e) => handleWpDrag(i, e) }}
            >
              <Popup>
                <div className="text-xs font-mono space-y-1">
                  <div className="font-bold text-slate-700">WP {i + 1}</div>
                  <div>Lat: {pos[0].toFixed(6)}</div>
                  <div>Lon: {pos[1].toFixed(6)}</div>
                  <button
                    onClick={() => handleWpDelete(i)}
                    className="mt-1 w-full py-0.5 rounded bg-red-50 text-red-600
                               text-[10px] font-bold uppercase tracking-widest
                               ring-1 ring-red-200 hover:bg-red-100 transition-colors"
                  >
                    Delete WP {i + 1}
                  </button>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>

      {/* Map legend */}
      <div className="px-4 py-2 flex items-center gap-4 border-b border-slate-100 bg-slate-50 shrink-0">
        <LegendItem color="#84cc16" dashed label="Search Polygon (drag vertices)" />
        <LegendItem color="#dc2626" dashed label="Hazard Zone (read-only)" />
        <LegendItem color="#2563eb" dashed label="Route" />
        <LegendItem color="#2563eb" circle label="Waypoint (drag to move)" />
      </div>

      {/* Stats row */}
      <div className="px-4 py-3 flex items-center gap-1 shrink-0 border-t border-slate-100">
        <StatCell label="Distance"      value={stats.distanceKm}          sub="km" />
        <div className="w-px h-8 bg-slate-100" />
        <StatCell label="Flight Time"   value={stats.flightTimeMin}       sub="min est." />
        <div className="w-px h-8 bg-slate-100" />
        <StatCell label="Coverage"      value={stats.coverageHa}          sub="ha" />
        <div className="w-px h-8 bg-slate-100" />
        <StatCell label="Batt. Reserve" value={`${stats.batteryReservePct}%`} sub="at RTL" />
      </div>
    </div>
  );
}

// ─── Legend item ──────────────────────────────────────────────────────────────

function LegendItem({ color, dashed, circle, label }) {
  return (
    <div className="flex items-center gap-1.5">
      {circle ? (
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: color,
            border: "2px solid white",
            boxShadow: `0 0 0 1.5px ${color}`,
          }}
        />
      ) : (
        <svg width="18" height="6" viewBox="0 0 18 6">
          <line
            x1="0"
            y1="3"
            x2="18"
            y2="3"
            stroke={color}
            strokeWidth="2"
            strokeDasharray={dashed ? "4 2" : "none"}
          />
        </svg>
      )}
      <span className="text-[10px] text-slate-400 font-medium">{label}</span>
    </div>
  );
}
