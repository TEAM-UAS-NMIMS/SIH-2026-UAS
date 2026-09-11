import { useMemo } from "react";

/**
 * ThermalPanel — a worked example of a product gridZERO does not yet build.
 *
 * The airframe has no thermal payload, so there is no thermal data to show. The
 * honest options are to hide the feature or to show what it *would* look like,
 * clearly labelled. Hiding it loses the design conversation; faking it would be
 * indefensible in a rescue tool.
 *
 * So this renders a synthetic scene from a fixed seed, marked as an
 * illustration on the image itself, alongside what the real product would
 * require. This is the one place in the console where a warm palette is
 * correct: a thermal map without an ironbow/inferno ramp is unreadable to
 * anyone trained on thermal imagery.
 */

const GRID_W = 48;
const GRID_H = 27;

/** Inferno-like ramp: cold purple-black through red and orange to white. */
function thermalColour(t) {
  const stops = [
    [0.00, [8, 6, 26]],
    [0.20, [62, 12, 94]],
    [0.40, [140, 26, 92]],
    [0.60, [211, 62, 46]],
    [0.80, [247, 143, 22]],
    [1.00, [252, 253, 191]],
  ];
  const x = Math.max(0, Math.min(1, t));
  for (let i = 1; i < stops.length; i++) {
    if (x <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      const f = (x - t0) / (t1 - t0);
      const c = c0.map((v, k) => Math.round(v + (c1[k] - v) * f));
      return `rgb(${c[0]},${c[1]},${c[2]})`;
    }
  }
  return "rgb(252,253,191)";
}

/** Deterministic pseudo-random, so the illustration is identical every render. */
function seeded(i) {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

export default function ThermalPanel() {
  const cells = useMemo(() => {
    // Three warm bodies plus a warm vehicle bonnet, on cool ground.
    const sources = [
      { x: 11, y: 9,  amp: 1.00, r: 2.4, label: "Human" },
      { x: 12.6, y: 10.5, amp: 0.92, r: 2.1, label: "Human" },
      { x: 33, y: 18, amp: 0.78, r: 2.8, label: "Human" },
      { x: 39, y: 7,  amp: 0.66, r: 4.5, label: "Engine" },
    ];

    const out = [];
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        let v = 0.1 + seeded(y * GRID_W + x) * 0.07;   // ground clutter
        for (const s of sources) {
          const d2 = (x - s.x) ** 2 + (y - s.y) ** 2;
          v += s.amp * Math.exp(-d2 / (2 * s.r * s.r));
        }
        out.push({ x, y, v: Math.min(1, v) });
      }
    }
    return out;
  }, []);

  const CELL = 13;

  return (
    <div className="flex flex-col gap-3">
      <p className="notice-caution">
        <strong>Not built.</strong> This airframe carries no thermal payload, so
        there is no thermal data for this mission. Everything below is a
        synthetic illustration of the intended product — it is not this
        mission's data and must never be read as such.
      </p>

      <div style={{ border: "1px solid var(--rule)", background: "#08061A" }}>
        <svg viewBox={`0 0 ${GRID_W * CELL} ${GRID_H * CELL + 26}`}
             width="100%" role="img"
             aria-label="Illustration of a thermal map showing three human-sized heat signatures and a vehicle engine">
          {cells.map((c) => (
            <rect key={`${c.x}-${c.y}`}
                  x={c.x * CELL} y={c.y * CELL}
                  width={CELL} height={CELL}
                  fill={thermalColour(c.v)} />
          ))}

          {/* Candidate boxes the detector would raise on this scene */}
          {[
            { x: 8.4,  y: 6.6,  w: 6.6, h: 6.4, t: "HUMAN 36.4°C" },
            { x: 30.4, y: 15.4, w: 5.2, h: 5.2, t: "HUMAN 35.1°C" },
            { x: 35.4, y: 3.6,  w: 7.4, h: 6.8, t: "ENGINE 58°C" },
          ].map((b) => (
            <g key={b.t}>
              <rect x={b.x * CELL} y={b.y * CELL}
                    width={b.w * CELL} height={b.h * CELL}
                    fill="none" stroke="#FFFFFF" strokeWidth="1.5" />
              <text x={b.x * CELL} y={b.y * CELL - 4}
                    fill="#FFFFFF" fontSize="10"
                    fontFamily='"IBM Plex Mono", monospace'>{b.t}</text>
            </g>
          ))}

          <text x={GRID_W * CELL - 8} y={16} textAnchor="end"
                fill="#FFFFFF" fontSize="11" fontWeight="700" opacity="0.9"
                fontFamily='"IBM Plex Mono", monospace'>
            ILLUSTRATION — NOT MISSION DATA
          </text>

          {/* Temperature scale */}
          <g transform={`translate(0,${GRID_H * CELL + 6})`}>
            {Array.from({ length: 60 }, (_, i) => (
              <rect key={i} x={i * ((GRID_W * CELL) / 60)} y={0}
                    width={(GRID_W * CELL) / 60} height={8}
                    fill={thermalColour(i / 59)} />
            ))}
            <text x="2" y={19} fill="var(--ink-3)" fontSize="9"
                  fontFamily='"IBM Plex Mono", monospace'>18°C</text>
            <text x={GRID_W * CELL - 2} y={19} textAnchor="end"
                  fill="var(--ink-3)" fontSize="9"
                  fontFamily='"IBM Plex Mono", monospace'>60°C</text>
          </g>
        </svg>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="px-2.5 py-2" style={{ background: "var(--surface-2)", border: "1px solid var(--rule)" }}>
          <div className="text-[10px] uppercase tracking-[0.12em] mb-1" style={{ color: "var(--ink-2)" }}>
            Why it matters for SAR
          </div>
          <ul className="text-[11px] leading-relaxed pl-4" style={{ color: "var(--ink-2)", listStyle: "disc" }}>
            <li>Finds casualties under canopy, in smoke, and at night, where RGB fails</li>
            <li>Separates a living body from debris by temperature, not shape</li>
            <li>Extends the search window past dusk — the golden hour rarely respects daylight</li>
          </ul>
        </div>
        <div className="px-2.5 py-2" style={{ background: "var(--surface-2)", border: "1px solid var(--rule)" }}>
          <div className="text-[10px] uppercase tracking-[0.12em] mb-1" style={{ color: "var(--ink-2)" }}>
            What building it needs
          </div>
          <ul className="text-[11px] leading-relaxed pl-4" style={{ color: "var(--ink-2)", listStyle: "disc" }}>
            <li>Radiometric thermal payload (FLIR Boson / Lepton class)</li>
            <li>Per-pixel temperature, not a false-colour video stream</li>
            <li>Thermal–RGB registration so one target yields one track</li>
            <li>A detector trained on thermal imagery; the RGB YOLO model does not transfer</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
