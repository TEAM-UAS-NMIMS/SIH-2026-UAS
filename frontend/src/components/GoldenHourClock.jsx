import { useState, useEffect } from "react";

/**
 * GoldenHourClock — time remaining in the survival window.
 *
 * In search and rescue the "golden hour" is the period after an incident in
 * which a casualty's survival odds are highest. gridZERO runs a 12-hour window
 * from mission start and shows it on every screen, because the single most
 * useful number to an incident commander is how much time is left.
 *
 * It counts DOWN and changes tone as the window closes:
 *   > 4 h   nominal (monochrome)
 *   1–4 h   caution
 *   < 1 h   critical
 *   expired critical, and says so rather than showing negative time
 *
 * The clock is driven by the backend's mission_start_time so every screen and
 * every operator station agrees on the same countdown.
 */

const WINDOW_SECONDS = 12 * 60 * 60;   // 12 h

function pad(n) {
  return String(Math.floor(n)).padStart(2, "0");
}

export default function GoldenHourClock({ startedAt }) {
  const [now, setNow] = useState(() => Date.now() / 1000);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(id);
  }, []);

  // No mission started yet — the clock has nothing to count and says so.
  if (!startedAt) {
    return (
      <span className="flex items-baseline gap-1.5" title="Starts when the mission begins">
        <span className="text-[9px] font-medium uppercase tracking-[0.12em]"
              style={{ color: "var(--ink-3)" }}>
          Golden hour
        </span>
        <span className="text-[11px] font-semibold tabular-nums"
              style={{ color: "var(--ink-3)", fontFamily: '"IBM Plex Mono", monospace' }}>
          ——:——:——
        </span>
      </span>
    );
  }

  const remaining = WINDOW_SECONDS - (now - startedAt);
  const expired = remaining <= 0;
  const abs = Math.max(0, remaining);

  const hours = abs / 3600;
  const tone =
    expired || hours < 1 ? "critical"
    : hours < 4 ? "caution"
    : "nominal";

  const color =
    tone === "critical" ? "var(--critical)"
    : tone === "caution" ? "var(--caution)"
    : "var(--ink)";

  const h = abs / 3600;
  const m = (abs % 3600) / 60;
  const sec = abs % 60;

  return (
    <span
      className="flex items-baseline gap-1.5"
      title="12-hour survival window from mission start"
    >
      <span className="text-[9px] font-medium uppercase tracking-[0.12em]"
            style={{ color: "var(--ink-3)" }}>
        Golden hour
      </span>
      <span
        className="text-[12px] font-semibold tabular-nums"
        style={{ color, fontFamily: '"IBM Plex Mono", monospace' }}
      >
        {expired ? "ELAPSED" : `${pad(h)}:${pad(m)}:${pad(sec)}`}
      </span>
    </span>
  );
}
