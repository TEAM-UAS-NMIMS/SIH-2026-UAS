import { useState } from "react";

/**
 * ReconPanel — worked example of photogrammetric 3D reconstruction.
 *
 * Not built. gridZERO records no overlapping stills and runs no structure-from-
 * motion, so there is no model to show. Rather than hide the idea or fake a
 * render, this shows an isometric wireframe of what the product would produce
 * and states plainly what building it requires.
 */

const SCENES = [
  {
    id: "collapse",
    label: "Collapsed structure",
    why: "Void spaces and debris depth decide where a team can safely dig.",
  },
  {
    id: "terrain",
    label: "Terrain / slope",
    why: "Slope and drainage predict where a casualty is carried to after a flood or slide.",
  },
];

export default function ReconPanel() {
  const [scene, setScene] = useState("collapse");

  // Deterministic isometric block field — a schematic, not a render.
  const blocks = [];
  for (let gx = 0; gx < 7; gx++) {
    for (let gy = 0; gy < 7; gy++) {
      const seed = Math.abs(Math.sin((gx * 7 + gy) * 12.9898) * 43758.5453) % 1;
      const h = scene === "collapse"
        ? 8 + seed * 46 * (gx > 2 && gx < 6 && gy > 1 && gy < 5 ? 1.5 : 0.45)
        : 10 + (gx + gy) * 3.2 + seed * 8;
      blocks.push({ gx, gy, h });
    }
  }

  const TILE = 34, HALF = TILE / 2, QUARTER = TILE / 4;
  const ox = 330, oy = 60;
  const iso = (gx, gy) => [ox + (gx - gy) * HALF, oy + (gx + gy) * QUARTER];

  return (
    <div className="flex flex-col gap-3">
      <p className="notice-caution">
        <strong>Not built.</strong> No overlapping imagery is captured and no
        structure-from-motion runs, so there is no model for this mission. The
        figure below is a schematic of the intended product, not mission data.
      </p>

      <div className="flex gap-1">
        {SCENES.map((s) => (
          <button
            key={s.id}
            onClick={() => setScene(s.id)}
            className="pill"
            style={scene === s.id
              ? { background: "var(--ink)", borderColor: "var(--ink)", color: "#fff" }
              : undefined}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div style={{ border: "1px solid var(--rule)", background: "var(--surface-2)" }}>
        <svg viewBox="0 0 660 330" width="100%" role="img"
             aria-label={"Isometric schematic of a " + scene + " reconstruction"}>
          {blocks.map(({ gx, gy, h }) => {
            const [x, y] = iso(gx, gy);
            const top = `${x},${y - h} ${x + HALF},${y - h + QUARTER} ${x},${y - h + HALF} ${x - HALF},${y - h + QUARTER}`;
            const left = `${x - HALF},${y - h + QUARTER} ${x},${y - h + HALF} ${x},${y + HALF} ${x - HALF},${y + QUARTER}`;
            const right = `${x + HALF},${y - h + QUARTER} ${x},${y - h + HALF} ${x},${y + HALF} ${x + HALF},${y + QUARTER}`;
            return (
              <g key={`${gx}-${gy}`}>
                <polygon points={top}   fill="#E8E8E8" stroke="#B4B4B4" strokeWidth="0.7" />
                <polygon points={left}  fill="#C4C4C4" stroke="#B4B4B4" strokeWidth="0.7" />
                <polygon points={right} fill="#A8A8A8" stroke="#B4B4B4" strokeWidth="0.7" />
              </g>
            );
          })}

          {/* A casualty position projected into the model */}
          {(() => {
            const [x, y] = iso(4, 3);
            return (
              <g>
                <circle cx={x} cy={y - 52} r="6" fill="none" stroke="#B0201A" strokeWidth="2" />
                <circle cx={x} cy={y - 52} r="2" fill="#B0201A" />
                <text x={x + 11} y={y - 49} fontSize="10" fill="#B0201A"
                      fontFamily='"IBM Plex Mono", monospace'>
                  CASUALTY · 2.4 m below surface
                </text>
              </g>
            );
          })()}

          <text x="650" y="18" textAnchor="end" fontSize="11" fontWeight="700"
                fill="var(--ink-3)" fontFamily='"IBM Plex Mono", monospace'>
            SCHEMATIC — NOT MISSION DATA
          </text>
        </svg>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="px-2.5 py-2" style={{ background: "var(--surface-2)", border: "1px solid var(--rule)" }}>
          <div className="text-[10px] uppercase tracking-[0.12em] mb-1" style={{ color: "var(--ink-2)" }}>
            Why it matters for SAR
          </div>
          <p className="text-[11px] leading-relaxed" style={{ color: "var(--ink-2)" }}>
            {SCENES.find((s) => s.id === scene)?.why} A ground team plans an
            approach from volume and depth, which a flat image cannot give them.
          </p>
        </div>
        <div className="px-2.5 py-2" style={{ background: "var(--surface-2)", border: "1px solid var(--rule)" }}>
          <div className="text-[10px] uppercase tracking-[0.12em] mb-1" style={{ color: "var(--ink-2)" }}>
            What building it needs
          </div>
          <ul className="text-[11px] leading-relaxed pl-4" style={{ color: "var(--ink-2)", listStyle: "disc" }}>
            <li>Stills at 70–80% overlap, geotagged per frame</li>
            <li>Structure-from-motion / MVS pass (OpenDroneMap or COLMAP)</li>
            <li>Minutes of offboard compute — not a live product</li>
            <li>RTK or ground control points for metric accuracy</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
