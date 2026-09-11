import { useMemo } from "react";

/**
 * CoveragePanel — how much of the search area has actually been swept.
 *
 * Method, stated on screen because a coverage number a rescue coordinator
 * cannot interrogate is worthless:
 *
 *   swath width = 2 · altitude_AGL · tan(HFOV / 2)
 *   covered     = Σ segment length × swath width
 *   percentage  = covered / search-area, capped at 100%
 *
 * Overlap between adjacent lanes is not subtracted, so this is an UPPER bound
 * and is labelled as such. The alternative used previously — the ratio of the
 * track's bounding box to the area's — reported 0% for a straight lane, which
 * is worse than an honest over-estimate.
 */

const HFOV_DEG = 69.4;   // RealSense D435 colour; matches backend/app/detection.py

function haversine(a, b) {
  const dn = (b.lat - a.lat) * 111111;
  const de = (b.lon - a.lon) * 111111 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dn, de);
}

function polygonAreaM2(poly) {
  if (!poly || poly.length < 3) return 0;
  const lat0 = poly.reduce((s, p) => s + p[0], 0) / poly.length;
  const mx = 111111 * Math.cos((lat0 * Math.PI) / 180);
  let acc = 0;
  for (let i = 0; i < poly.length; i++) {
    const [y1, x1] = poly[i];
    const [y2, x2] = poly[(i + 1) % poly.length];
    acc += x1 * mx * y2 * 111111 - x2 * mx * y1 * 111111;
  }
  return Math.abs(acc) / 2;
}

export default function CoveragePanel({ flightPath, searchPolygon, altitude, error }) {
  const model = useMemo(() => {
    const alt = Number.isFinite(altitude) && altitude > 0 ? altitude : 45;
    const swath = 2 * alt * Math.tan((HFOV_DEG * Math.PI) / 360);
    const areaM2 = polygonAreaM2(searchPolygon);

    // Cumulative coverage per sample, for the progress curve.
    const series = [];
    let dist = 0;
    for (let i = 1; i < flightPath.length; i++) {
      dist += haversine(flightPath[i - 1], flightPath[i]);
      const pct = areaM2 > 0 ? Math.min(100, ((dist * swath) / areaM2) * 100) : 0;
      series.push({
        t: flightPath[i].t - flightPath[0].t,
        pct,
        distance: dist,
      });
    }

    const last = series[series.length - 1];
    return {
      swath, areaM2, series,
      pathM: dist,
      pct: last?.pct ?? 0,
      elapsed: last?.t ?? 0,
      alt,
    };
  }, [flightPath, searchPolygon, altitude]);

  if (error) {
    return <p className="notice-critical">Could not load the flight track: {error}</p>;
  }
  if (flightPath.length < 2) {
    return (
      <p className="notice">
        No flight track recorded yet. Coverage is computed from the positions the
        aircraft actually reported — fly a mission, or press Demo in the header.
      </p>
    );
  }

  const W = 640, H = 120, PAD = 4;
  const maxT = model.series[model.series.length - 1]?.t || 1;
  const points = model.series
    .map((s) => {
      const x = PAD + (s.t / maxT) * (W - 2 * PAD);
      const y = H - PAD - (s.pct / 100) * (H - 2 * PAD);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-4 gap-2">
        {[
          { l: "Swept",        v: `${model.pct.toFixed(1)}%`, s: "of search area" },
          { l: "Track flown",  v: `${(model.pathM / 1000).toFixed(2)} km`, s: `${model.elapsed.toFixed(0)} s elapsed` },
          { l: "Swath width",  v: `${model.swath.toFixed(0)} m`, s: `at ${model.alt.toFixed(0)} m AGL` },
          { l: "Search area",  v: `${(model.areaM2 / 10000).toFixed(1)} ha`, s: "from the planned polygon" },
        ].map(({ l, v, s }) => (
          <div key={l} className="px-2.5 py-2"
               style={{ background: "var(--surface-2)", border: "1px solid var(--rule)" }}>
            <div className="text-[9px] uppercase tracking-[0.12em]" style={{ color: "var(--ink-3)" }}>{l}</div>
            <div className="text-[17px] font-semibold tabular-nums"
                 style={{ fontFamily: '"IBM Plex Mono", monospace' }}>{v}</div>
            <div className="text-[9.5px]" style={{ color: "var(--ink-3)" }}>{s}</div>
          </div>
        ))}
      </div>

      {/* Coverage against time — the sweep algorithm's progress. */}
      <div>
        <div className="flex items-baseline justify-between mb-1">
          <span className="text-[10px] uppercase tracking-[0.12em]" style={{ color: "var(--ink-2)" }}>
            Coverage accumulated
          </span>
          <span className="text-[9.5px]" style={{ color: "var(--ink-3)" }}>
            lawnmower sweep · {flightPath.length} position samples
          </span>
        </div>
        <div style={{ border: "1px solid var(--rule)", background: "#fff" }}>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="120"
               preserveAspectRatio="none" role="img"
               aria-label={`Coverage reached ${model.pct.toFixed(1)} percent over ${model.elapsed.toFixed(0)} seconds`}>
            {[25, 50, 75].map((g) => (
              <line key={g} x1={PAD} x2={W - PAD}
                    y1={H - PAD - (g / 100) * (H - 2 * PAD)}
                    y2={H - PAD - (g / 100) * (H - 2 * PAD)}
                    stroke="var(--rule)" strokeWidth="1" />
            ))}
            <polyline points={points} fill="none" stroke="#111111" strokeWidth="1.75" />
            {model.series.length > 0 && (() => {
              const s = model.series[model.series.length - 1];
              const x = PAD + (s.t / maxT) * (W - 2 * PAD);
              const y = H - PAD - (s.pct / 100) * (H - 2 * PAD);
              return <circle cx={x} cy={y} r="3" fill="#111111" />;
            })()}
          </svg>
        </div>
        <div className="flex justify-between text-[9px] mt-0.5" style={{ color: "var(--ink-3)" }}>
          <span>0 s</span>
          <span>100% coverage at top · {maxT.toFixed(0)} s</span>
        </div>
      </div>

      <p className="notice">
        <strong>Method.</strong> Coverage = (track length × sensor swath) ÷ search area,
        where swath = 2·altitude·tan(HFOV/2) with HFOV {HFOV_DEG}°. Overlap between
        adjacent lanes is not subtracted, so this is an <em>upper bound</em> on the
        area genuinely observed.
      </p>
    </div>
  );
}
