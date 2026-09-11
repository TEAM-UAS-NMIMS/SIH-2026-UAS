import { useState, useEffect, useRef, useMemo } from "react";
import Icon from "../Icon";

/**
 * ReplayPanel — scrub the recorded flight track.
 *
 * The previous replay printed coordinates next to a slider and moved nothing,
 * so it read as a data table rather than a replay. This draws the track and
 * moves an aircraft marker along it, with playback, and marks where each
 * casualty was found so the operator can see *when* in the sortie a find
 * happened relative to the sweep.
 *
 * Drawn as a local projection to SVG rather than on a map: the track's own
 * shape is the information here, and at this scale a basemap adds nothing but
 * clutter and tile requests.
 */

const SPEEDS = [1, 4, 16];

export default function ReplayPanel({ flightPath, detections }) {
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(4);
  const raf = useRef(null);

  const n = flightPath.length;

  useEffect(() => { if (idx > n - 1) setIdx(Math.max(0, n - 1)); }, [n, idx]);

  // Playback advances in wall-clock proportion to the recording.
  useEffect(() => {
    if (!playing || n < 2) return;
    let last = performance.now();
    const tick = (now) => {
      const dt = (now - last) / 1000;
      last = now;
      setIdx((i) => {
        const next = i + dt * speed * (n / Math.max(1, duration));
        if (next >= n - 1) { setPlaying(false); return n - 1; }
        return next;
      });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, speed, n]);

  const duration = useMemo(
    () => (n >= 2 ? flightPath[n - 1].t - flightPath[0].t : 0),
    [flightPath, n],
  );

  const proj = useMemo(() => {
    if (n === 0) return null;
    const lats = flightPath.map((p) => p.lat);
    const lons = flightPath.map((p) => p.lon);
    const [latMin, latMax] = [Math.min(...lats), Math.max(...lats)];
    const [lonMin, lonMax] = [Math.min(...lons), Math.max(...lons)];
    const W = 640, H = 260, PAD = 18;
    const spanLat = Math.max(1e-6, latMax - latMin);
    const spanLon = Math.max(1e-6, lonMax - lonMin);
    const scale = Math.min((W - 2 * PAD) / spanLon, (H - 2 * PAD) / spanLat);
    const ox = PAD + ((W - 2 * PAD) - spanLon * scale) / 2;
    const oy = PAD + ((H - 2 * PAD) - spanLat * scale) / 2;

    const to = (lat, lon) => [
      ox + (lon - lonMin) * scale,
      H - oy - (lat - latMin) * scale,
    ];
    return { W, H, to };
  }, [flightPath, n]);

  if (n < 2 || !proj) {
    return (
      <p className="notice">
        No flight track recorded yet. Replay needs at least two position samples —
        fly a mission, or press Demo in the header.
      </p>
    );
  }

  const i = Math.min(n - 1, Math.max(0, Math.round(idx)));
  const cur = flightPath[i];
  const elapsed = cur.t - flightPath[0].t;

  const trackPts = flightPath.map((p) => proj.to(p.lat, p.lon).join(",")).join(" ");
  const flownPts = flightPath.slice(0, i + 1)
    .map((p) => proj.to(p.lat, p.lon).join(",")).join(" ");
  const [cx, cy] = proj.to(cur.lat, cur.lon);

  // Casualty markers, placed at the moment they were first seen.
  const finds = detections
    .filter((d) => d.lat != null && d.first_seen)
    .map((d) => {
      const [x, y] = proj.to(d.lat, d.lon);
      const revealed = d.first_seen <= cur.t;
      return { ...d, x, y, revealed };
    });

  return (
    <div className="flex flex-col gap-2.5">
      <div style={{ border: "1px solid var(--rule)", background: "#fff" }}>
        <svg viewBox={`0 0 ${proj.W} ${proj.H}`} width="100%" height="260"
             role="img" aria-label="Recorded flight track with playback position">
          {/* Full planned track, then the portion flown so far */}
          <polyline points={trackPts} fill="none" stroke="var(--rule-strong)"
                    strokeWidth="1.5" strokeDasharray="3 4" />
          <polyline points={flownPts} fill="none" stroke="#111111" strokeWidth="2" />

          {finds.map((f) => (
            <g key={f.id} opacity={f.revealed ? 1 : 0.18}>
              <circle cx={f.x} cy={f.y} r="6" fill="none"
                      stroke={f.priority === "high" ? "#B0201A"
                            : f.priority === "medium" ? "#8A5A00" : "#111111"}
                      strokeWidth="1.75" />
              <circle cx={f.x} cy={f.y} r="2" fill={
                f.priority === "high" ? "#B0201A"
                : f.priority === "medium" ? "#8A5A00" : "#111111"} />
            </g>
          ))}

          {/* Aircraft */}
          <circle cx={cx} cy={cy} r="5.5" fill="#111111" />
          <circle cx={cx} cy={cy} r="10" fill="none" stroke="#111111"
                  strokeWidth="1" opacity="0.35" />
        </svg>
      </div>

      <div className="flex items-center gap-2">
        <button className="btn" onClick={() => setPlaying((p) => !p)}
                title={playing ? "Pause" : "Play the recorded track"}>
          <Icon name={playing ? "square" : "play"} size={12} />
          {playing ? "Pause" : "Play"}
        </button>
        <button className="btn" onClick={() => { setIdx(0); setPlaying(false); }}>
          Reset
        </button>
        <div className="flex gap-1">
          {SPEEDS.map((s) => (
            <button key={s} className="pill" onClick={() => setSpeed(s)}
                    style={speed === s
                      ? { background: "var(--ink)", borderColor: "var(--ink)", color: "#fff" }
                      : undefined}>
              {s}×
            </button>
          ))}
        </div>
        <span className="flex-1" />
        <span className="text-[11px] tabular-nums"
              style={{ fontFamily: '"IBM Plex Mono", monospace', color: "var(--ink-2)" }}>
          {cur.lat.toFixed(6)}, {cur.lon.toFixed(6)}
        </span>
      </div>

      <input
        id="replay-scrub"
        type="range"
        min={0}
        max={n - 1}
        step={1}
        value={i}
        onChange={(e) => { setIdx(Number(e.target.value)); setPlaying(false); }}
        className="w-full"
        aria-label="Scrub the flight track"
      />

      <div className="flex justify-between text-[10px]" style={{ color: "var(--ink-3)" }}>
        <span>t = {elapsed.toFixed(0)} s</span>
        <span>sample {i + 1} / {n}</span>
        <span>{duration.toFixed(0)} s recorded</span>
      </div>

      <p className="notice">
        Circles mark where each casualty was first detected; they appear as the
        replay reaches that point in the sortie. The dashed line is the full
        recorded track, solid is what has been replayed.
      </p>
    </div>
  );
}
