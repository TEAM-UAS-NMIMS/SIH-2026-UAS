/**
 * AnalysisToolsList — right column of AnalysisScreen.
 * Props: { detections, flightPath, events, searchPolygon }
 *       (all passed down from AnalysisScreen so the tools can use real data)
 *
 * Tools list:
 *   3D Reconstruction — "Not available in this build — concept only"
 *   Thermal Map       — "Not available in this build — concept only"
 *   Coverage Map      — inline coverage stats from real position history
 *   Hazard Zone       — lists events with severity="critical" from the log
 *   Flight Replay     — step-through of flightPath positions
 *   Export            — JSON download of the full mission dataset
 *   Generate Report   — navigate to /report
 */
import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";

// ─── Tool content panels ──────────────────────────────────────────────────────

/** Clearly-labelled "concept only" placeholder used for unimplemented tools. */
function ConceptOnlyPanel({ name }) {
  return (
    <div className="flex flex-col items-center gap-3 py-6 px-3 text-center">
      <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center text-2xl">
        🔬
      </div>
      <p className="text-sm font-bold text-slate-600">{name}</p>
      <div className="rounded-lg bg-amber-50 ring-1 ring-amber-200 px-4 py-3 w-full text-left">
        <p className="text-[11px] font-bold text-amber-700 uppercase tracking-wider mb-1">
          Not available in this build
        </p>
        <p className="text-xs text-amber-600">
          This is a concept placeholder only. No real {name.toLowerCase()} data
          is generated or displayed. Feature is planned for a future build.
        </p>
      </div>
    </div>
  );
}

/** Coverage Map — uses real flightPath + searchPolygon data. */
function CoverageMapPanel({ flightPath, searchPolygon }) {
  // Replicate the bounding-box ratio calculation from state.py
  let areaPct = 0;
  if (flightPath.length >= 2 && searchPolygon.length >= 2) {
    const lats = flightPath.map((p) => p[0]);
    const lons = flightPath.map((p) => p[1]);
    const flown = (Math.max(...lats) - Math.min(...lats))
                * (Math.max(...lons) - Math.min(...lons));
    const pLats = searchPolygon.map((p) => p[0]);
    const pLons = searchPolygon.map((p) => p[1]);
    const poly  = (Math.max(...pLats) - Math.min(...pLats))
                * (Math.max(...pLons) - Math.min(...pLons));
    if (poly > 0) areaPct = Math.min(100, (flown / poly) * 100);
  }

  const barColor = areaPct >= 80 ? "#16a34a" : areaPct >= 50 ? "#d97706" : "#dc2626";

  return (
    <div className="flex flex-col gap-3 px-3 py-4">
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
        Coverage estimate
      </p>
      <div className="text-3xl font-bold text-slate-800 tabular-nums">
        {areaPct.toFixed(1)}%
      </div>
      <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${areaPct}%`, background: barColor }}
        />
      </div>
      <p className="text-[11px] text-slate-400">
        Based on bounding box of {flightPath.length} GPS samples vs. search
        polygon extent. Not a true coverage algorithm.
      </p>
      <div className="text-[11px] font-mono text-slate-500 bg-slate-50
                      rounded px-2.5 py-2 flex flex-col gap-1">
        <div><span className="text-slate-400">Path pts:</span> {flightPath.length}</div>
        <div><span className="text-slate-400">Polygon pts:</span> {searchPolygon.length}</div>
      </div>
    </div>
  );
}

/** Hazard Zone — critical events from the log. */
function HazardPanel({ events }) {
  const critical = events.filter((e) => e.severity === "critical");
  const warnings = events.filter((e) => e.severity === "warning");
  return (
    <div className="flex flex-col gap-2 px-3 py-4">
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
        Critical events during mission
      </p>
      {critical.length === 0 && warnings.length === 0 && (
        <p className="text-xs text-slate-400 italic">No hazard events logged.</p>
      )}
      {[...critical, ...warnings].map((ev, i) => (
        <div
          key={i}
          className={`rounded-md px-3 py-2 text-xs font-medium
            ${ev.severity === "critical"
              ? "bg-red-50 text-red-700 ring-1 ring-red-200"
              : "bg-amber-50 text-amber-700 ring-1 ring-amber-200"
            }`}
        >
          <span className="font-mono text-[10px] opacity-70 block mb-0.5">
            {new Date(ev.timestamp * 1000).toLocaleTimeString()}
          </span>
          {ev.message}
        </div>
      ))}
    </div>
  );
}

/** Flight Replay — step through position history manually. */
function FlightReplayPanel({ flightPath }) {
  const [step, setStep] = useState(0);
  const total = flightPath.length;

  if (total === 0) {
    return (
      <div className="px-3 py-4 text-xs text-slate-400 italic">
        No GPS path recorded this session.
      </div>
    );
  }

  const pt = flightPath[step];
  const progress = total > 1 ? (step / (total - 1)) * 100 : 100;

  return (
    <div className="flex flex-col gap-3 px-3 py-4">
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
        Step through flight path
      </p>
      <div className="flex items-center gap-2">
        <button
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
          className="px-2.5 py-1.5 rounded text-xs font-bold bg-slate-100
                     hover:bg-slate-200 disabled:opacity-40 transition-all"
        >
          ◀
        </button>
        <input
          type="range"
          min={0}
          max={total - 1}
          value={step}
          onChange={(e) => setStep(Number(e.target.value))}
          className="flex-1"
        />
        <button
          onClick={() => setStep((s) => Math.min(total - 1, s + 1))}
          disabled={step === total - 1}
          className="px-2.5 py-1.5 rounded text-xs font-bold bg-slate-100
                     hover:bg-slate-200 disabled:opacity-40 transition-all"
        >
          ▶
        </button>
      </div>
      <div className="text-[11px] font-mono text-slate-600 bg-slate-50
                      rounded px-2.5 py-2 flex flex-col gap-1">
        <div>
          <span className="text-slate-400">Step:</span>{" "}
          {step + 1} / {total}
        </div>
        <div>
          <span className="text-slate-400">Lat:</span>{" "}
          {pt[0].toFixed(6)}
        </div>
        <div>
          <span className="text-slate-400">Lon:</span>{" "}
          {pt[1].toFixed(6)}
        </div>
        <div>
          <span className="text-slate-400">Progress:</span>{" "}
          {progress.toFixed(1)}%
        </div>
      </div>
    </div>
  );
}

/** Export — JSON download of full mission dataset. */
function ExportPanel({ detections, flightPath, events }) {
  const [exported, setExported] = useState(false);

  function handleExport() {
    const payload = {
      exported_at:   new Date().toISOString(),
      detections,
      flight_path:   flightPath,
      events,
      format_version: "1.0",
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a   = document.createElement("a");
    a.href     = url;
    a.download = `gridZERO_mission_export_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setExported(true);
    setTimeout(() => setExported(false), 2500);
  }

  return (
    <div className="flex flex-col gap-3 px-3 py-4">
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
        Export mission data
      </p>
      <p className="text-xs text-slate-500">
        Downloads a JSON file containing all detections, the recorded flight
        path, and the event timeline from this session.
      </p>
      <div className="text-[11px] font-mono text-slate-500 bg-slate-50
                      rounded px-2.5 py-2 flex flex-col gap-1">
        <div><span className="text-slate-400">Detections:</span> {detections.length}</div>
        <div><span className="text-slate-400">Path pts:</span> {flightPath.length}</div>
        <div><span className="text-slate-400">Events:</span> {events.length}</div>
      </div>
      <button
        onClick={handleExport}
        className={`w-full py-2.5 rounded-lg text-xs font-bold tracking-widest uppercase
          transition-all ${exported
            ? "bg-green-100 text-green-700 ring-1 ring-green-200"
            : "bg-slate-800 text-white hover:bg-slate-700"
          }`}
      >
        {exported ? "✓ Downloaded" : "⬇ Download JSON"}
      </button>
    </div>
  );
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS = [
  { id: "3d",       label: "3D Reconstruction", icon: "🗿", conceptOnly: true  },
  { id: "thermal",  label: "Thermal Map",        icon: "🌡", conceptOnly: true  },
  { id: "coverage", label: "Coverage Map",       icon: "📐", conceptOnly: false },
  { id: "hazard",   label: "Hazard Map",         icon: "⚠️", conceptOnly: false },
  { id: "replay",   label: "Flight Replay",      icon: "▶️", conceptOnly: false },
  { id: "export",   label: "Export",             icon: "⬇️", conceptOnly: false },
  { id: "report",   label: "Generate Report",    icon: "📄", conceptOnly: false },
];

// ─── AnalysisToolsList ────────────────────────────────────────────────────────

export default function AnalysisToolsList({
  detections    = [],
  flightPath    = [],
  events        = [],
  searchPolygon = [],
}) {
  const [activeTool, setActiveTool] = useState(null);
  const navigate = useNavigate();

  function handleSelect(tool) {
    if (tool.id === "report") {
      navigate("/report");
      return;
    }
    setActiveTool((prev) => (prev?.id === tool.id ? null : tool));
  }

  return (
    <div className="panel flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-3 pb-2 border-b border-slate-100 shrink-0">
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest">
          Analysis Tools
        </h2>
      </div>

      {/* Tool list + optional expanded panel */}
      <div className="flex-1 overflow-y-auto">
        {TOOLS.map((tool) => {
          const isActive = activeTool?.id === tool.id;
          return (
            <div key={tool.id}>
              {/* Tool row */}
              <button
                onClick={() => handleSelect(tool)}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left
                  border-b border-slate-50 transition-colors
                  ${isActive
                    ? "bg-blue-50 border-l-2 border-l-blue-500"
                    : "hover:bg-slate-50"
                  }`}
              >
                <span className="text-base leading-none">{tool.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className={`text-xs font-semibold ${isActive ? "text-blue-700" : "text-slate-700"}`}>
                    {tool.label}
                  </p>
                  {tool.conceptOnly && (
                    <p className="text-[9px] text-amber-500 font-semibold uppercase tracking-wide">
                      Concept only
                    </p>
                  )}
                </div>
                <span className="text-slate-300 text-xs">
                  {tool.id === "report" ? "→" : isActive ? "▲" : "▼"}
                </span>
              </button>

              {/* Expanded content */}
              {isActive && (
                <div className="bg-slate-50 border-b border-slate-100">
                  {tool.conceptOnly ? (
                    <ConceptOnlyPanel name={tool.label} />
                  ) : tool.id === "coverage" ? (
                    <CoverageMapPanel flightPath={flightPath} searchPolygon={searchPolygon} />
                  ) : tool.id === "hazard" ? (
                    <HazardPanel events={events} />
                  ) : tool.id === "replay" ? (
                    <FlightReplayPanel flightPath={flightPath} />
                  ) : tool.id === "export" ? (
                    <ExportPanel detections={detections} flightPath={flightPath} events={events} />
                  ) : null}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
