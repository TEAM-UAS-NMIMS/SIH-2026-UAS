/**
 * ReportScreen — the mission report a rescue force can act on.
 *
 * Rebuilt around dispatch: the previous report ranked contacts and stopped
 * there, which leaves an incident commander to work out distance, bearing,
 * sweep radius and resourcing themselves. This leads with the force-level
 * picture, then gives one dispatch card per casualty carrying everything a
 * team needs to reach them.
 *
 * Every figure traces to data gridZERO holds. Where something cannot be
 * derived — no terrain model, no triage, no position fix — the card says so
 * instead of guessing.
 */
import { useState, useEffect, useCallback } from "react";
import { api } from "../config";
import Icon from "../components/Icon";
import StatusPill from "../components/StatusPill";
import GoldenHourClock from "../components/GoldenHourClock";

const TIER_TONE = {
  URGENT: "critical",
  HIGH:   "critical",
  MEDIUM: "caution",
  LOW:    "nominal",
  "N/A":  "absent",
};

const HAZARD_TONE = {
  inside:  "critical",
  close:   "caution",
  clear:   "nominal",
  unknown: "absent",
};

const POSTURE_LABEL = {
  commit:   "Commit team",
  verify:   "Verify then commit",
  "re-fly": "Re-fly before committing",
};

function Field({ label, value, mono = false, tone }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-[0.12em]" style={{ color: "var(--ink-3)" }}>
        {label}
      </div>
      <div
        className={`text-[13px] font-semibold ${mono ? "tabular-nums" : ""}`}
        style={{
          fontFamily: mono ? '"IBM Plex Mono", monospace' : undefined,
          color: tone === "critical" ? "var(--critical)"
               : tone === "caution" ? "var(--caution)"
               : tone === "absent" ? "var(--ink-3)"
               : "var(--ink)",
        }}
      >
        {value}
      </div>
    </div>
  );
}

/** One casualty, as a card a team can be briefed from. */
function DispatchCard({ item }) {
  const [open, setOpen] = useState(item.rank <= 2);
  const r = item.rescue ?? {};
  const ap = r.approach ?? {};
  const hz = r.hazard ?? {};
  const sp = r.search_pattern;
  const vf = r.verification ?? {};
  const rs = r.resourcing ?? {};

  const tone = TIER_TONE[item.tier] ?? "nominal";
  const accent = tone === "critical" ? "var(--critical)"
               : tone === "caution" ? "var(--caution)" : "var(--ink)";

  return (
    <div className="panel overflow-hidden" style={{ borderLeft: `3px solid ${accent}` }}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left"
        style={{ borderBottom: open ? "1px solid var(--rule)" : "none" }}
      >
        <span
          className="shrink-0 w-6 h-6 inline-flex items-center justify-center text-[11px] font-bold"
          style={{ background: accent, color: "#fff", borderRadius: 2,
                   fontFamily: '"IBM Plex Mono", monospace' }}
        >
          {item.rank}
        </span>
        <StatusPill tone={tone} label={item.tier} dot />
        <span className="text-[12px] font-semibold tabular-nums"
              style={{ fontFamily: '"IBM Plex Mono", monospace' }}>
          {item.lat != null ? `${item.lat.toFixed(6)}, ${item.lon.toFixed(6)}` : "no position fix"}
        </span>
        <span className="flex-1" />
        <span className="text-[10.5px] hidden md:inline" style={{ color: "var(--ink-2)" }}>
          {r.order}
        </span>
        <span style={{ transform: open ? "rotate(90deg)" : "none", color: "var(--ink-3)" }}>
          <Icon name="play" size={10} />
        </span>
      </button>

      {open && (
        <div className="p-3 flex flex-col gap-3">
          {/* The four numbers a team leader reads first */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field
              label="Distance"
              value={ap.distance_m != null ? `${ap.distance_m.toFixed(0)} m` : "——"}
              mono
              tone={ap.distance_m == null ? "absent" : undefined}
            />
            <Field
              label="Bearing"
              value={ap.bearing_deg != null ? `${ap.bearing_deg}° ${ap.cardinal}` : "——"}
              mono
              tone={ap.bearing_deg == null ? "absent" : undefined}
            />
            <Field
              label="On foot"
              value={ap.on_foot ?? "——"}
              mono
              tone={ap.on_foot ? undefined : "absent"}
            />
            <Field
              label="Sweep radius"
              value={sp?.radius_m != null ? `${sp.radius_m} m` : "assess on arrival"}
              mono
              tone={sp?.radius_m == null ? "absent" : undefined}
            />
          </div>

          <div className="grid md:grid-cols-2 gap-2">
            {/* Hazard */}
            <div className={hz.level === "inside" ? "notice-critical"
                          : hz.level === "close" ? "notice-caution" : "notice"}>
              <div className="flex items-center gap-1.5 mb-1">
                <Icon name="alert-triangle" size={12} />
                <strong className="text-[10px] uppercase tracking-[0.1em]">
                  Hazard — {hz.level ?? "unknown"}
                </strong>
              </div>
              {hz.note}
            </div>

            {/* Verification posture */}
            <div className={vf.posture === "re-fly" ? "notice-caution" : "notice"}>
              <div className="flex items-center gap-1.5 mb-1">
                <Icon name="search" size={12} />
                <strong className="text-[10px] uppercase tracking-[0.1em]">
                  {POSTURE_LABEL[vf.posture] ?? "Verification"}
                </strong>
              </div>
              {vf.note}
            </div>

            {/* Search pattern */}
            {sp && (
              <div className="notice">
                <div className="flex items-center gap-1.5 mb-1">
                  <Icon name="grid" size={12} />
                  <strong className="text-[10px] uppercase tracking-[0.1em]">
                    {sp.method}
                  </strong>
                </div>
                {sp.note}
              </div>
            )}

            {/* Resourcing */}
            <div className="notice">
              <div className="flex items-center gap-1.5 mb-1">
                <Icon name="user" size={12} />
                <strong className="text-[10px] uppercase tracking-[0.1em]">
                  {rs.team}
                </strong>
              </div>
              {rs.equipment}. {rs.note}
            </div>
          </div>

          {/* Why this contact ranks where it does */}
          <div className="px-2.5 py-2"
               style={{ background: "var(--surface-2)", border: "1px solid var(--rule)" }}>
            <div className="text-[9px] uppercase tracking-[0.12em] mb-1"
                 style={{ color: "var(--ink-3)" }}>
              Evidence &amp; ranking
            </div>
            <p className="text-[11.5px] leading-relaxed">{item.justification}</p>
            {item.score_components && (
              <p className="text-[10px] mt-1.5 tabular-nums"
                 style={{ color: "var(--ink-3)", fontFamily: '"IBM Plex Mono", monospace' }}>
                score {item.score} = conf {item.score_components.confidence_score}×0.50
                {" "}+ prox {item.score_components.proximity_score}×0.30
                {" "}+ age {item.score_components.age_score}×0.20
              </p>
            )}
            {item.notes && (
              <p className="text-[11px] mt-1.5">
                <strong>Analyst note: </strong>{item.notes}
              </p>
            )}
          </div>

          {ap.known === false && (
            <p className="notice-critical">{ap.note}</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function ReportScreen() {
  const [report, setReport] = useState(null);
  const [error, setError]   = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(api("/api/report"));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setReport(await res.json());
      setError(null);
    } catch (err) {
      setError(err.message ?? "Could not load the report");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading && !report) {
    return (
      <main className="h-full flex items-center justify-center">
        <p className="text-[12px]" style={{ color: "var(--ink-3)" }}>Building report…</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="h-full flex items-center justify-center p-6">
        <div className="panel p-6 flex flex-col items-center gap-3 max-w-sm text-center">
          <Icon name="alert-triangle" size={26} style={{ color: "var(--critical)" }} />
          <p className="text-[13px] font-semibold">Report unavailable</p>
          <p className="text-[11px]" style={{ color: "var(--ink-3)" }}>{error}</p>
          <button className="btn btn-primary" onClick={load}>Retry</button>
        </div>
      </main>
    );
  }

  const rs = report.rescue_summary ?? {};
  const ranked = report.ranked_detections ?? [];
  const counts = report.summary_counts ?? {};
  const stats = report.mission_stats ?? {};
  const taskable = ranked.filter((r) => r.status !== "rejected" && r.lat != null);

  return (
    <main className="h-full overflow-y-auto scroll-thin p-2">
      <div className="flex flex-col gap-2 max-w-[78rem] mx-auto">

        {/* ── Header ── */}
        <div className="panel p-3.5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-[17px] font-bold tracking-tight">
                  Mission Report — {report.mission?.name}
                </h1>
                <StatusPill
                  tone={rs.urgent_count ? "critical" : rs.high_count ? "caution" : "nominal"}
                  label={
                    rs.actionable_count
                      ? `${rs.actionable_count} actionable`
                      : "No actionable contacts"
                  }
                />
              </div>
              <p className="text-[10.5px] mt-1" style={{ color: "var(--ink-3)" }}>
                {report.mission?.operator} · {report.mission?.area} ·{" "}
                {report.mission?.type} · generated{" "}
                {new Date(report.generated_at).toLocaleString("en-GB")}
              </p>
            </div>
            <div className="flex items-center gap-4">
              <GoldenHourClock startedAt={report.mission_start} />
              <button className="btn" onClick={load}>Refresh</button>
            </div>
          </div>
        </div>

        {/* ── Force-level summary ── */}
        <div className="panel">
          <div className="panel-head">
            <h2 className="panel-title">Incident Commander Summary</h2>
            <StatusPill tone="nominal" label={`${rs.teams_recommended ?? 0} teams recommended`} />
          </div>
          <div className="p-3 flex flex-col gap-3">
            <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
              <Field label="Urgent"     value={rs.urgent_count ?? 0} mono
                     tone={rs.urgent_count ? "critical" : undefined} />
              <Field label="High"       value={rs.high_count ?? 0} mono
                     tone={rs.high_count ? "caution" : undefined} />
              <Field label="Actionable" value={rs.actionable_count ?? 0} mono />
              <Field label="No fix"     value={rs.unlocatable_count ?? 0} mono
                     tone={rs.unlocatable_count ? "caution" : undefined} />
              <Field label="VIO-located" value={rs.degraded_position_count ?? 0} mono
                     tone={rs.degraded_position_count ? "caution" : undefined} />
              <Field label="Area swept" value={`${stats.area_covered_pct ?? 0}%`} mono />
            </div>

            {(rs.notes ?? []).length > 0 && (
              <ul className="flex flex-col gap-1.5">
                {rs.notes.map((n, i) => (
                  <li key={i} className="notice flex items-start gap-2">
                    <Icon name="alert-triangle" size={12} className="mt-[2px] shrink-0" />
                    <span>{n}</span>
                  </li>
                ))}
              </ul>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2"
                 style={{ borderTop: "1px solid var(--rule)" }}>
              <Field label="Mission duration"
                     value={`${((stats.duration_seconds ?? 0) / 60).toFixed(1)} min`} mono />
              <Field label="Casualties tracked" value={stats.detection_count ?? 0} mono />
              <Field label="Rejected by analyst" value={stats.rejected_count ?? 0} mono />
              <Field label="GNSS outage"
                     value={`${stats.gnss_outage_seconds ?? 0} s`} mono
                     tone={(stats.gnss_outage_seconds ?? 0) > 0 ? "caution" : undefined} />
            </div>
          </div>
        </div>

        {/* ── Immediate orders ── */}
        {(report.top_actions ?? []).length > 0 && (
          <div className="panel">
            <div className="panel-head">
              <h2 className="panel-title">Immediate Orders</h2>
              <StatusPill tone="nominal" label="Top 3 taskable" />
            </div>
            <div className="p-3 flex flex-col gap-1.5">
              {report.top_actions.map((a) => (
                <div key={a.detection_id} className="flex items-start gap-2.5 px-2.5 py-2"
                     style={{ background: "var(--surface-2)", border: "1px solid var(--rule)" }}>
                  <span className="shrink-0 w-5 h-5 inline-flex items-center justify-center
                                   text-[10px] font-bold"
                        style={{ background: "var(--ink)", color: "#fff", borderRadius: 2,
                                 fontFamily: '"IBM Plex Mono", monospace' }}>
                    {a.rank}
                  </span>
                  <p className="text-[12px] leading-snug">{a.action}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Dispatch cards ── */}
        <div className="flex items-center justify-between px-1 pt-1">
          <h2 className="panel-title">Dispatch Cards</h2>
          <span className="text-[10px]" style={{ color: "var(--ink-3)" }}>
            {taskable.length} taskable of {ranked.length} tracked ·{" "}
            {counts.URGENT ?? 0} urgent / {counts.HIGH ?? 0} high /{" "}
            {counts.MEDIUM ?? 0} medium / {counts.LOW ?? 0} low
          </span>
        </div>

        {ranked.length === 0 ? (
          <p className="notice">
            No casualties were detected. Nothing to dispatch — continue or
            re-task the search.
          </p>
        ) : (
          ranked.map((item) => <DispatchCard key={item.id} item={item} />)
        )}

        <p className="text-[10px] py-3" style={{ color: "var(--ink-3)" }}>
          Ranking: score = 0.50×confidence + 0.30×hazard proximity + 0.20×age.
          Tiers: URGENT ≥ 0.75, HIGH ≥ 0.55, MEDIUM ≥ 0.35. All justifications are
          template-assembled from recorded values — no language model is involved.
          gridZERO holds no terrain model and no medical triage, so ground
          conditions and casualty condition must be assessed on arrival.
        </p>
      </div>
    </main>
  );
}
