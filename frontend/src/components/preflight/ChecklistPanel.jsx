import { useState } from "react";
import Icon from "../Icon";
import StatusPill from "../StatusPill";
import { api } from "../../config";

/**
 * ChecklistPanel — the pre-flight checklist an operator actually works through.
 *
 * Two kinds of row, visually distinct because they mean different things:
 *
 *   AUTO   read from the aircraft. No checkbox — the operator cannot assert
 *          something the telemetry contradicts.
 *   MANUAL a physical or procedural check. A checkbox the operator ticks; the
 *          tick is POSTed and persisted server-side, so it survives navigation
 *          and can be cited in the mission report.
 *
 * Launch gates on hard failures only. Critical manual items start as failures
 * precisely so they must be worked through — that is the point of a checklist —
 * while non-critical ones are cautions the operator may knowingly accept.
 */

const STATUS_CONFIG = {
  pass: { icon: "check",          fg: "var(--ink)",      bg: "#fff",                 ring: "var(--rule-strong)" },
  warn: { icon: "alert-triangle", fg: "var(--caution)",  bg: "var(--caution-bg)",    ring: "#E6D3AE" },
  fail: { icon: "x",              fg: "var(--critical)", bg: "var(--critical-bg)",   ring: "#E9C3C0" },
  skip: { icon: "minus",          fg: "var(--ink-3)",    bg: "var(--surface-2)",     ring: "var(--rule)" },
};

const SECTION_ICON = {
  "Airframe & Propulsion": "plane",
  "Power":                 "battery",
  "Navigation & Position": "satellite-dish",
  "Communications":        "signal",
  "Payload & Detection":   "camera",
  "Mission & Airspace":    "map",
  "Crew & Safety":         "shield",
};

function StatusIcon({ status }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.skip;
  return (
    <span
      className="inline-flex items-center justify-center w-[18px] h-[18px] shrink-0"
      style={{ background: cfg.bg, color: cfg.fg, border: `1px solid ${cfg.ring}`, borderRadius: 2 }}
    >
      <Icon name={cfg.icon} size={11} strokeWidth={3} />
    </span>
  );
}

function CheckItem({ item, onToggle, pending }) {
  const isManual = item.kind === "manual";

  return (
    <div
      className="flex items-start gap-2.5 py-2"
      style={{ borderBottom: "1px solid var(--rule)" }}
    >
      {isManual ? (
        <button
          onClick={() => onToggle(item)}
          disabled={pending}
          aria-pressed={item.acked}
          title={item.acked ? "Clear this confirmation" : "Confirm this check"}
          className="shrink-0 mt-[1px]"
          style={{
            width: 18, height: 18, borderRadius: 2,
            border: `1px solid ${item.acked ? "var(--ink)" : "var(--rule-strong)"}`,
            background: item.acked ? "var(--ink)" : "#fff",
            color: "#fff",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            cursor: pending ? "wait" : "pointer",
            opacity: pending ? 0.5 : 1,
          }}
        >
          {item.acked && <Icon name="check" size={11} strokeWidth={3} />}
        </button>
      ) : (
        <StatusIcon status={item.status} />
      )}

      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-medium leading-tight">{item.label}</p>
        {item.detail && (
          <p className="text-[10.5px] mt-0.5 leading-snug" style={{ color: "var(--ink-3)" }}>
            {item.detail}
          </p>
        )}
      </div>

      {/* Non-nominal AUTO rows carry their state; manual rows carry their kind. */}
      {isManual
        ? !item.acked && (
            <StatusPill
              tone={item.critical ? "critical" : "caution"}
              label={item.critical ? "Required" : "Confirm"}
            />
          )
        : item.status !== "pass" && (
            <StatusPill
              tone={item.status === "fail" ? "critical"
                   : item.status === "warn" ? "caution" : "absent"}
              label={item.status === "skip" ? "No data" : item.status}
            />
          )}
    </div>
  );
}

function ChecklistSection({ section, onToggle, pending }) {
  const countable = section.items.filter((i) => i.status !== "skip");
  const passCount = countable.filter((i) => i.status === "pass").length;
  const allPass = passCount === countable.length && countable.length > 0;

  return (
    <div>
      <div className="flex items-center justify-between pt-2.5 pb-1">
        <div className="flex items-center gap-1.5">
          <Icon name={SECTION_ICON[section.name] ?? "square"} size={13}
                style={{ color: "var(--ink-2)" }} />
          <span className="text-[10px] font-semibold uppercase tracking-[0.13em]"
                style={{ color: "var(--ink-2)" }}>
            {section.name}
          </span>
        </div>
        <span className="text-[10px] font-semibold tabular-nums"
              style={{ color: allPass ? "var(--ink)" : "var(--caution)",
                       fontFamily: '"IBM Plex Mono", monospace' }}>
          {passCount}/{countable.length}
        </span>
      </div>
      {section.items.map((item) => (
        <CheckItem key={item.id} item={item} onToggle={onToggle}
                   pending={pending === item.id} />
      ))}
    </div>
  );
}

function ReadinessRing({ score, subScores }) {
  const R = 30, C = 2 * Math.PI * R;
  const tone = score >= 90 ? "var(--ink)" : score >= 70 ? "var(--caution)" : "var(--critical)";

  return (
    <div className="flex items-center gap-3">
      <svg width="72" height="72" viewBox="0 0 72 72" className="shrink-0">
        <circle cx="36" cy="36" r={R} fill="none" stroke="var(--rule)" strokeWidth="6" />
        <circle
          cx="36" cy="36" r={R} fill="none" stroke={tone} strokeWidth="6"
          strokeDasharray={`${(score / 100) * C} ${C}`}
          strokeLinecap="butt" transform="rotate(-90 36 36)"
        />
        <text x="36" y="34" textAnchor="middle" fontSize="17" fontWeight="700"
              fill="var(--ink)" fontFamily='"IBM Plex Mono", monospace'>{score}</text>
        <text x="36" y="46" textAnchor="middle" fontSize="7"
              fill="var(--ink-3)" letterSpacing="1">READY</text>
      </svg>
      <div className="flex-1 min-w-0 flex flex-col gap-[3px]">
        {subScores.map(({ label, score: s }) => (
          <div key={label} className="flex items-center gap-1.5">
            <span className="text-[9px] truncate" style={{ color: "var(--ink-3)", width: "5.2rem" }}>
              {label}
            </span>
            <div className="flex-1 h-[3px]" style={{ background: "var(--rule)" }}>
              <div style={{
                width: `${s}%`, height: "100%",
                background: s >= 90 ? "var(--ink)" : s >= 70 ? "var(--caution)" : "var(--critical)",
              }} />
            </div>
            <span className="text-[9px] tabular-nums w-6 text-right"
                  style={{ color: "var(--ink-2)" }}>{s}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ChecklistPanel({ checklist, onLaunch, launchError }) {
  const { sections, readinessScore, subScores, failCount, warnCount,
          manualDone, manualTotal } = checklist;
  const [pending, setPending] = useState(null);

  const isLaunchReady = failCount === 0;

  async function toggle(item) {
    setPending(item.id);
    try {
      await fetch(api("/api/preflight/ack"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_id: item.id, ack: !item.acked }),
      });
      // The acknowledgement arrives back on the next WebSocket broadcast, so
      // there is nothing to reconcile locally.
    } catch {
      /* the row simply stays untricked; the operator can retry */
    } finally {
      setPending(null);
    }
  }

  async function resetAll() {
    setPending("__reset__");
    try {
      await fetch(api("/api/preflight/reset"), { method: "POST" });
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="panel p-3.5 flex flex-col h-full overflow-hidden">
      <div className="pb-2.5 mb-1 shrink-0" style={{ borderBottom: "1px solid var(--rule)" }}>
        <div className="flex items-center justify-between">
          <h2 className="panel-title">Pre-Flight Checklist</h2>
          <button className="pill" onClick={resetAll} disabled={!!pending}
                  title="Clear all operator confirmations for a new sortie">
            New sortie
          </button>
        </div>
        <p className="text-[10.5px] mt-1" style={{ color: "var(--ink-3)" }}>
          {manualDone}/{manualTotal} crew confirmations ·{" "}
          {failCount > 0
            ? `${failCount} blocking`
            : warnCount > 0 ? `${warnCount} caution${warnCount > 1 ? "s" : ""}` : "all clear"}
        </p>
      </div>

      <div className="pb-3 mb-1 shrink-0" style={{ borderBottom: "1px solid var(--rule)" }}>
        <ReadinessRing score={readinessScore} subScores={subScores} />
      </div>

      <div className="flex-1 overflow-y-auto scroll-thin min-h-0 pr-1">
        {sections.map((section) => (
          <ChecklistSection key={section.name} section={section}
                            onToggle={toggle} pending={pending} />
        ))}
      </div>

      <div className="pt-3 shrink-0">
        {launchError && (
          <div className="notice-critical mb-2">
            <strong className="block uppercase tracking-wide text-[10px] mb-0.5">
              Launch failed
            </strong>
            {launchError}
          </div>
        )}

        <button
          disabled={!isLaunchReady}
          onClick={isLaunchReady ? onLaunch : undefined}
          className="cmd-btn"
          style={isLaunchReady
            ? { background: "var(--ink)", color: "#fff" }
            : undefined}
        >
          <span className="inline-flex items-center justify-center gap-1.5">
            {isLaunchReady && <Icon name="rocket" size={14} />}
            {isLaunchReady ? "Launch Mission" : `Launch Blocked — ${failCount} item${failCount > 1 ? "s" : ""}`}
          </span>
        </button>

        {isLaunchReady && warnCount > 0 && (
          <p className="text-[10px] text-center mt-1.5" style={{ color: "var(--caution)" }}>
            {warnCount} caution{warnCount > 1 ? "s" : ""} accepted by the operator
          </p>
        )}
      </div>
    </div>
  );
}
