import Icon from "../Icon";

/**
 * ChecklistPanel — right column of PreFlightScreen.
 * Receives computed checklist from PreFlightScreen (built from live telemetry).
 * Props: { checklist, onLaunch }
 *   checklist — { sections, readinessScore, subScores } built in PreFlightScreen
 *   onLaunch  — async callback: calls POST /api/mission/phase then navigates
 */

// ─── Status icon ──────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  pass: { icon: "check",           bg: "bg-green-100", text: "text-green-700", ring: "ring-green-200" },
  warn: { icon: "alert-triangle",  bg: "bg-amber-100", text: "text-amber-700", ring: "ring-amber-200" },
  fail: { icon: "x",               bg: "bg-red-100",   text: "text-red-700",   ring: "ring-red-200"   },
  skip: { icon: "minus",           bg: "bg-slate-100", text: "text-slate-500", ring: "ring-slate-200" },
};

function StatusIcon({ status }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.skip;
  return (
    <span
      className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-bold ring-1 shrink-0
                  ${cfg.bg} ${cfg.text} ${cfg.ring}`}
    >
      <Icon name={cfg.icon} size={12} strokeWidth={3} />
    </span>
  );
}

// ─── Checklist item ───────────────────────────────────────────────────────────

function CheckItem({ item }) {
  const isOk = item.status === "pass";
  return (
    <div className="flex items-start gap-2.5 py-2 border-b border-slate-50 last:border-0">
      <StatusIcon status={item.status} />
      <div className="flex-1 min-w-0">
        <p className={`text-[13px] font-medium leading-tight ${isOk ? "text-slate-700" : "text-slate-800"}`}>
          {item.label}
        </p>
        {item.detail && (
          <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">{item.detail}</p>
        )}
      </div>
    </div>
  );
}

// ─── Checklist section ────────────────────────────────────────────────────────

const SECTION_ICON = {
  Airframe:         "plane",
  Position:         "satellite-dish",
  Communication:    "signal",
  Power:            "battery",
  Payload:          "camera",
  "Mission Safety": "shield",
};

function ChecklistSection({ section }) {
  const passCount = section.items.filter((i) => i.status === "pass").length;
  const total     = section.items.length;
  const allPass   = passCount === total;

  return (
    <div>
      {/* Section header */}
      <div className="flex items-center justify-between pt-2 pb-1">
        <div className="flex items-center gap-1.5">
          <Icon name={SECTION_ICON[section.name] ?? "square"} size={14} className="text-slate-500" />
          <span className="text-xs font-bold text-slate-600 uppercase tracking-widest">
            {section.name}
          </span>
        </div>
        <span
          className={`text-[10px] font-bold tabular-nums ${
            allPass ? "text-green-600" : "text-amber-600"
          }`}
        >
          {passCount}/{total}
        </span>
      </div>

      {/* Items */}
      <div>
        {section.items.map((item, i) => (
          <CheckItem key={i} item={item} />
        ))}
      </div>
    </div>
  );
}

// ─── Flat two-tone readiness ring (SVG, no glow) ─────────────────────────────

function ReadinessRing({ score, subScores }) {
  const SIZE   = 96;
  const STROKE = 9;
  const R      = (SIZE - STROKE) / 2;
  const C      = 2 * Math.PI * R;
  const filled = (C * score) / 100;

  return (
    <div className="flex flex-col items-center gap-3">
      {/* Ring */}
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} style={{ transform: "rotate(-90deg)" }}>
          {/* Track */}
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            fill="none"
            stroke="#e2e8f0"
            strokeWidth={STROKE}
          />
          {/* Progress — flat, no gradient */}
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            fill="none"
            stroke={score >= 90 ? "#16a34a" : score >= 70 ? "#d97706" : "#dc2626"}
            strokeWidth={STROKE}
            strokeDasharray={`${filled} ${C - filled}`}
            strokeLinecap="butt"
          />
        </svg>
        {/* Score label */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-bold text-slate-800 tabular-nums leading-none">
            {score}
          </span>
          <span className="text-[10px] text-slate-400 font-semibold tracking-wider mt-0.5">
            READY
          </span>
        </div>
      </div>

      {/* Sub-scores */}
      <div className="w-full flex flex-col gap-1.5">
        {subScores.map(({ label, score: s }) => (
          <div key={label} className="flex items-center gap-2">
            <span className="text-[10px] text-slate-400 w-28 shrink-0 uppercase tracking-wide font-medium">
              {label}
            </span>
            {/* Flat bar */}
            <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${s}%`,
                  background: s >= 90 ? "#16a34a" : s >= 70 ? "#d97706" : "#dc2626",
                }}
              />
            </div>
            <span className="text-[10px] text-slate-500 font-bold tabular-nums w-7 text-right">
              {s}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── ChecklistPanel ───────────────────────────────────────────────────────────

export default function ChecklistPanel({ checklist, onLaunch, launchError }) {
  const { sections, readinessScore, subScores } = checklist;

  // Count items by status so we can show informational counts.
  const allItems = sections.flatMap((s) => s.items);
  const warnCount = allItems.filter((i) => i.status === "warn").length;
  const failCount = allItems.filter((i) => i.status === "fail").length;

  // Gate ONLY on hard failures (dynamic signals: GPS fix lost, battery critical,
  // armed during pre-flight, etc.).  Static warns (Geofence, Observer, RC RSSI…)
  // are visible cautions but do NOT block launch — the operator cannot clear them
  // without additional hardware wiring that isn't in scope for this build.
  const isLaunchReady = failCount === 0;

  return (
    <div className="panel p-4 flex flex-col gap-0 h-full overflow-hidden">
      {/* Title */}
      <div className="pb-3 border-b border-slate-100 mb-2 shrink-0">
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest">
          Pre-Flight Checklist
        </h2>
        {warnCount > 0 && (
          <p className="text-[11px] text-amber-600 font-semibold mt-0.5">
            {warnCount} issue{warnCount > 1 ? "s" : ""} require attention
          </p>
        )}
      </div>

      {/* Readiness ring */}
      <div className="pb-4 border-b border-slate-100 mb-2 shrink-0">
        <ReadinessRing score={readinessScore} subScores={subScores} />
      </div>

      {/* Checklist sections — scrollable */}
      <div className="flex-1 overflow-y-auto min-h-0 pr-0.5">
        <div className="flex flex-col gap-2">
          {sections.map((section, i) => (
            <ChecklistSection key={i} section={section} />
          ))}
        </div>
      </div>

      {/* Launch button */}
      <div className="pt-3 shrink-0">
        {/* Network / API error from the last launch attempt */}
        {launchError && (
          <div className="mb-2 rounded-md bg-red-50 ring-1 ring-red-200 px-3 py-2">
            <p className="text-[11px] font-bold text-red-600 uppercase tracking-wide mb-0.5">
              Launch failed
            </p>
            <p className="text-[11px] text-red-500 font-mono">{launchError}</p>
          </div>
        )}

        <button
          disabled={!isLaunchReady}
          onClick={isLaunchReady ? onLaunch : undefined}
          className={`w-full py-3 rounded-lg text-sm font-bold tracking-widest uppercase transition-all
            ${
              isLaunchReady
                ? "bg-green-600 hover:bg-green-700 text-white shadow-sm"
                : "bg-slate-100 text-slate-400 ring-1 ring-slate-200 cursor-not-allowed"
            }`}
        >
          <span className="inline-flex items-center justify-center gap-1.5">
            {isLaunchReady && <Icon name="rocket" size={15} />}
            {isLaunchReady ? "Launch Mission" : "Launch Mission — Not Ready"}
          </span>
        </button>

        {/* Status line under button */}
        {!isLaunchReady && failCount > 0 && (
          <p className="text-[10px] text-red-500 text-center mt-1.5 font-semibold">
            {failCount} critical issue{failCount > 1 ? "s" : ""} must be resolved
          </p>
        )}
        {isLaunchReady && warnCount > 0 && (
          <p className="text-[10px] text-amber-500 text-center mt-1.5">
            {warnCount} caution{warnCount > 1 ? "s" : ""} — operator acknowledges
          </p>
        )}
      </div>
    </div>
  );
}
