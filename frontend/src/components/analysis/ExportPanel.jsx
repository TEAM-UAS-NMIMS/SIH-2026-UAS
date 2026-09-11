import { useState } from "react";
import Icon from "../Icon";

/**
 * ExportPanel — the mission record, as files a rescue organisation can keep.
 *
 * All three formats are real and generated client-side from the data already on
 * screen. GeoJSON is included because it is what an incident-command GIS
 * actually ingests, and it is trivial to produce — it was previously a stub for
 * no good reason.
 */

function download(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function csvEscape(v) {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

const CRIT_ORDER = { high: 0, medium: 1, low: 2 };

export default function ExportPanel({ detections, flightPath, events, mission }) {
  const [done, setDone] = useState(null);

  function flash(what) {
    setDone(what);
    setTimeout(() => setDone(null), 3000);
  }

  function exportJson() {
    download(
      JSON.stringify(
        {
          exported_at: new Date().toISOString(),
          mission: {
            name: mission.name,
            operator: mission.operator,
            area: mission.area,
            type: mission.type,
            searchPolygon: mission.searchPolygon,
            geofence: mission.geofence,
            hazardZone: mission.hazardZone,
            waypoints: mission.waypoints,
            stats: mission.stats,
          },
          detections,
          flight_path: flightPath,
          events,
        },
        null,
        2,
      ),
      `gridzero-mission-${stamp()}.json`,
      "application/json",
    );
    flash("JSON");
  }

  function exportCsv() {
    const headers = [
      "rank", "criticality", "confidence_pct", "status", "lat", "lon",
      "position_source", "uncertainty_m", "sightings",
      "first_seen_iso", "last_seen_iso", "notes",
    ];
    const rows = [...detections]
      .sort(
        (a, b) =>
          (CRIT_ORDER[a.priority] ?? 3) - (CRIT_ORDER[b.priority] ?? 3) ||
          b.confidence - a.confidence,
      )
      .map((d, i) =>
        [
          i + 1,
          d.priority,
          (d.confidence * 100).toFixed(1),
          d.status ?? "pending",
          d.lat ?? "",
          d.lon ?? "",
          d.position_source ?? "",
          d.uncertainty_m ?? "",
          d.sightings ?? "",
          d.first_seen ? new Date(d.first_seen * 1000).toISOString() : "",
          d.last_seen ? new Date(d.last_seen * 1000).toISOString() : "",
          d.notes ?? "",
        ]
          .map(csvEscape)
          .join(","),
      );
    download(
      [headers.join(","), ...rows].join("\r\n"),
      `gridzero-casualties-${stamp()}.csv`,
      "text/csv",
    );
    flash("CSV");
  }

  function exportGeoJson() {
    const features = [];

    for (const d of detections) {
      if (d.lat == null) continue;
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [d.lon, d.lat] },
        properties: {
          kind: "casualty",
          criticality: d.priority,
          confidence: d.confidence,
          status: d.status ?? "pending",
          position_source: d.position_source,
          uncertainty_m: d.uncertainty_m,
          sightings: d.sightings,
          notes: d.notes ?? null,
        },
      });
    }

    if (flightPath.length >= 2) {
      features.push({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: flightPath.map((p) => [p.lon, p.lat]),
        },
        properties: { kind: "flight_track", samples: flightPath.length },
      });
    }

    const areas = [
      ["searchPolygon", "search_area"],
      ["geofence", "geofence"],
      ["hazardZone", "hazard_zone"],
    ];
    for (const [key, kind] of areas) {
      const poly = mission[key];
      if (poly && poly.length >= 3) {
        const ring = poly.map((p) => [p[1], p[0]]);
        ring.push([poly[0][1], poly[0][0]]);   // GeoJSON rings must close
        features.push({
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [ring] },
          properties: { kind },
        });
      }
    }

    download(
      JSON.stringify({ type: "FeatureCollection", features }, null, 2),
      `gridzero-mission-${stamp()}.geojson`,
      "application/geo+json",
    );
    flash("GeoJSON");
  }

  const items = [
    {
      icon: "file-text",
      label: "Mission record (JSON)",
      sub: "Everything: detections, track, events, geometry",
      fn: exportJson,
    },
    {
      icon: "bar-chart",
      label: "Casualty list (CSV)",
      sub: "One row per casualty, ranked — opens in Excel",
      fn: exportCsv,
    },
    {
      icon: "globe",
      label: "GeoJSON for GIS",
      sub: "Points, track and areas for incident-command mapping",
      fn: exportGeoJson,
    },
  ];

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-3 gap-2">
        {items.map(({ icon, label, sub, fn }) => (
          <button
            key={label}
            onClick={fn}
            className="flex flex-col items-start gap-1 px-3 py-2.5 text-left"
            style={{ border: "1px solid var(--rule-strong)", borderRadius: 2, background: "#fff" }}
          >
            <Icon name={icon} size={15} style={{ color: "var(--ink-2)" }} />
            <span className="text-[12px] font-semibold">{label}</span>
            <span className="text-[10px] leading-snug" style={{ color: "var(--ink-3)" }}>
              {sub}
            </span>
          </button>
        ))}
      </div>

      {done && (
        <p className="notice">
          {done} downloaded — {detections.length} casualt
          {detections.length === 1 ? "y" : "ies"}, {flightPath.length} track samples,{" "}
          {events.length} events.
        </p>
      )}

      <p className="text-[10px]" style={{ color: "var(--ink-3)" }}>
        All three formats are generated from the data on this screen. Coordinates
        are WGS-84; GeoJSON uses lon/lat order per RFC 7946.
      </p>
    </div>
  );
}
