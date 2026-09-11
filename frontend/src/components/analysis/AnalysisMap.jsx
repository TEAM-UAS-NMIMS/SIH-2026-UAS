/**
 * AnalysisMap — post-mission map for AnalysisScreen.
 *
 * Props:
 *   detections    Array<detection> — detection list (from context / parent)
 *   flightPath    Array<[lat,lon]> — ordered position samples from the session
 *   searchPolygon Array<[lat,lon]> — mission search polygon
 *   onSelectDet   fn(detection)   — called when user clicks a detection marker
 *
 * Features beyond MapPanel (phase 5):
 *   - Polyline flight path drawn as a thin blue line.
 *   - Approximate shaded coverage corridor: a Leaflet Polygon formed by
 *     widening the flight path polyline left+right by a fixed offset (~0.0001°
 *     ≈ 11 m) using a simple perpendicular-normal approach. This is not a
 *     real coverage algorithm — it is clearly labeled "Approximate coverage
 *     corridor" in the legend.
 *   - Detection markers use the same priority-coloured dot pattern as MapPanel;
 *     clicking calls onSelectDet instead of opening a Leaflet popup.
 *   - Search polygon shown as a thin lime outline.
 *   - Map auto-fits to the union of flight path + detections on mount.
 *
 * Only imports react, react-leaflet, leaflet.
 */
import { useMemo, useEffect } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Polyline,
  Polygon,
  Circle,
  useMap,
} from "react-leaflet";
import L from "leaflet";

// ─── Leaflet icon fix ─────────────────────────────────────────────────────────
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl:       "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl:     "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

// ─── Priority colours (same as MapPanel) ─────────────────────────────────────
const PRIORITY_COLOR = {
  high:   "#dc2626",
  medium: "#d97706",
  low:    "#16a34a",
};

const STATUS_OPACITY = {
  confirmed: 1.0,
  rejected:  0.35,
  pending:   0.8,
};

function makeDetectionIcon(priority, status) {
  const color = PRIORITY_COLOR[priority] ?? "#64748b";
  const opacity = STATUS_OPACITY[status] ?? 0.8;
  const size = 14;
  return L.divIcon({
    className: "",
    html: `<div style="
      width:${size}px;height:${size}px;border-radius:50%;
      background:${color};border:2.5px solid white;opacity:${opacity};
      box-shadow:0 0 0 1.5px ${color}80,0 1px 4px rgba(0,0,0,.35);
    "></div>`,
    iconAnchor:  [size / 2, size / 2],
    popupAnchor: [0, -(size / 2 + 6)],
  });
}

// ─── Coverage corridor from polyline ─────────────────────────────────────────
// Given an ordered list of [lat,lon] points, returns a polygon that
// approximates a corridor of width `halfWidthDeg` either side of the path.
// Strategy: for each segment, compute a perpendicular unit normal in
// lat/lon space (equal-degree treatment; sufficient at small scales) and
// offset each point outward. The final polygon is formed by the left-side
// points forward then the right-side points reversed.

function buildCorridor(points, halfWidthDeg = 0.00012) {
  if (points.length < 2) return null;
  const left  = [];
  const right = [];

  for (let i = 0; i < points.length; i++) {
    // Average the direction from the neighbouring segments for interior points.
    const prev = i > 0 ? points[i - 1] : points[i];
    const next = i < points.length - 1 ? points[i + 1] : points[i];

    const dy = next[0] - prev[0]; // delta lat
    const dx = next[1] - prev[1]; // delta lon
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) {
      // Duplicate points — use the same offsets as previous
      left.push(left[left.length - 1] ?? points[i]);
      right.push(right[right.length - 1] ?? points[i]);
      continue;
    }
    // Perpendicular normal: rotate (dx,dy) by 90° → (-dy, dx)
    const nx = -dy / len;
    const ny =  dx / len;

    const [lat, lon] = points[i];
    left.push( [lat + nx * halfWidthDeg, lon + ny * halfWidthDeg]);
    right.push([lat - nx * halfWidthDeg, lon - ny * halfWidthDeg]);
  }

  return [...left, ...[...right].reverse()];
}

// ─── AutoFit — fits map bounds to cover all meaningful data ──────────────────

function AutoFit({ points }) {
  const map = useMap();
  useEffect(() => {
    if (!points || points.length === 0) return;
    const bounds = L.latLngBounds(points.map(([la, lo]) => [la, lo]));
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 17 });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);   // Run only once on mount
  return null;
}

// ─── Detection marker (click to select, no popup) ────────────────────────────

function DetectionMarker({ det, onSelect }) {
  if (det.lat == null || det.lon == null) return null;
  const icon = useMemo(
    () => makeDetectionIcon(det.priority, det.status),
    [det.priority, det.status]
  );
  return (
    <Marker
      position={[det.lat, det.lon]}
      icon={icon}
      eventHandlers={{ click: () => onSelect(det) }}
    />
  );
}

// ─── AnalysisMap ──────────────────────────────────────────────────────────────

const DEFAULT_CENTER = [51.505, -0.09];
const DEFAULT_ZOOM   = 14;

export default function AnalysisMap({
  detections    = [],
  flightPath    = [],
  searchPolygon = [],
  onSelectDet   = () => {},
}) {
  // Build auto-fit point set: flight path + detection positions
  const fitPoints = useMemo(() => {
    const pts = [...flightPath];
    detections.forEach((d) => {
      if (d.lat != null && d.lon != null) pts.push([d.lat, d.lon]);
    });
    return pts;
  }, [flightPath, detections]);

  // Coverage corridor polygon
  const corridorPoly = useMemo(
    () => buildCorridor(flightPath),
    [flightPath]
  );

  const initialCenter = fitPoints.length > 0 ? fitPoints[0] : DEFAULT_CENTER;

  return (
    <div className="panel overflow-hidden flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="px-3 pt-2.5 pb-2 flex items-center justify-between shrink-0 border-b border-slate-100">
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest">
          Analysis Map
        </h2>
        <div className="flex items-center gap-2 text-[10px] text-slate-400 font-mono">
          <span>{detections.length} detections</span>
          <span>·</span>
          <span>{flightPath.length} path pts</span>
        </div>
      </div>

      {/* Map */}
      <div className="flex-1 min-h-0">
        <MapContainer
          center={initialCenter}
          zoom={DEFAULT_ZOOM}
          style={{ width: "100%", height: "100%" }}
          zoomControl
          scrollWheelZoom
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {/* Auto-fit on mount */}
          {fitPoints.length > 0 && <AutoFit points={fitPoints} />}

          {/* ── Search polygon — thin lime outline, unfilled ── */}
          {searchPolygon.length >= 3 && (
            <Polygon
              positions={searchPolygon}
              pathOptions={{
                color: "#84cc16",   // lime-500
                weight: 1.5,
                fill: false,
                dashArray: "4 3",
              }}
            />
          )}

          {/* ── Coverage corridor — semi-transparent blue fill ── */}
          {/* APPROXIMATE shaded corridor — NOT a real coverage algorithm.
              Width is fixed at ~13 m each side of the recorded GPS path.  */}
          {corridorPoly && (
            <Polygon
              positions={corridorPoly}
              pathOptions={{
                color:       "#3b82f6",   // blue-500
                weight:      0.5,
                fillColor:   "#3b82f6",
                fillOpacity: 0.18,
              }}
            />
          )}

          {/* ── Flight path polyline ── */}
          {flightPath.length >= 2 && (
            <Polyline
              positions={flightPath}
              pathOptions={{ color: "#2563eb", weight: 2, opacity: 0.8 }}
            />
          )}

          {/* ── Detection markers ── */}
          {detections.map((det) => (
            <DetectionMarker key={det.id} det={det} onSelect={onSelectDet} />
          ))}
        </MapContainer>
      </div>

      {/* Legend */}
      <div className="px-3 py-1.5 border-t border-slate-100 bg-slate-50 flex items-center gap-4 shrink-0">
        <LegendLine color="#2563eb" label="Flight path" />
        <LegendFill  color="#3b82f6" label="Approx. coverage corridor" />
        <LegendLine color="#84cc16" label="Search polygon" dashed />
        <LegendDot  color="#dc2626" label="High priority" />
        <LegendDot  color="#d97706" label="Medium priority" />
        <LegendDot  color="#16a34a" label="Low priority" />
      </div>
    </div>
  );
}

// ─── Legend sub-components ────────────────────────────────────────────────────

function LegendLine({ color, label, dashed }) {
  return (
    <div className="flex items-center gap-1.5">
      <svg width="18" height="8" viewBox="0 0 18 8">
        <line
          x1="0" y1="4" x2="18" y2="4"
          stroke={color} strokeWidth="2"
          strokeDasharray={dashed ? "4 2" : undefined}
        />
      </svg>
      <span className="text-[10px] text-slate-400 font-medium">{label}</span>
    </div>
  );
}

function LegendFill({ color, label }) {
  return (
    <div className="flex items-center gap-1.5">
      <div
        style={{
          width: 16, height: 8, borderRadius: 2,
          background: color, opacity: 0.35,
          border: `1px solid ${color}`,
        }}
      />
      <span className="text-[10px] text-slate-400 font-medium">{label}</span>
    </div>
  );
}

function LegendDot({ color, label }) {
  return (
    <div className="flex items-center gap-1.5">
      <span style={{
        display: "inline-block", width: 8, height: 8, borderRadius: "50%",
        background: color, border: "1.5px solid white",
        boxShadow: `0 0 0 1px ${color}`,
      }} />
      <span className="text-[10px] text-slate-400 font-medium">{label}</span>
    </div>
  );
}
