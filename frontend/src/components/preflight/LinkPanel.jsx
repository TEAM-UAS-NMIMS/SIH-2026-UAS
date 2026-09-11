import { useState, useEffect, useCallback } from "react";
import { api } from "../../config";
import StatusPill from "../StatusPill";

/**
 * LinkPanel — connect a real Pixhawk from the console.
 *
 * The MAVLink target used to be fixed at process start from an environment
 * variable, so plugging in a flight controller meant editing a variable and
 * restarting the backend. That is unusable in the field and impossible to show
 * to anyone: you cannot restart a ground station while an operator stands at
 * the aircraft.
 *
 * This gives the operator the Mission Planner workflow — scan ports, pick a
 * baud rate, test, connect — plus the vehicle actions that matter before
 * launch: arm/disarm, flight mode, and uploading the planned route.
 *
 * Every result shown here is the autopilot's real answer. A refused arm reads
 * as refused.
 */

const LINK_TYPES = [
  { id: "serial", label: "Serial / USB", hint: "Pixhawk over USB or a telemetry radio" },
  { id: "udp",    label: "UDP",          hint: "SITL or a companion computer" },
  { id: "tcp",    label: "TCP",          hint: "SITL on tcp:5760" },
];

export default function LinkPanel({ waypointCount = 0 }) {
  const [linkType, setLinkType] = useState("serial");
  const [ports, setPorts]       = useState([]);
  const [bauds, setBauds]       = useState([115200, 57600]);
  const [device, setDevice]     = useState("");
  const [baud, setBaud]         = useState(115200);
  const [host, setHost]         = useState("127.0.0.1");
  const [port, setPort]         = useState(14550);

  const [status, setStatus]   = useState(null);
  const [busy, setBusy]       = useState(null);   // action name in flight
  const [result, setResult]   = useState(null);   // {ok, detail}
  const [modes, setModes]     = useState([]);
  const [mode, setMode]       = useState("");

  const connected = !!status?.connected;

  // ── Port discovery ──────────────────────────────────────────────────────
  const scan = useCallback(async () => {
    setBusy("scan");
    try {
      const r = await fetch(api("/api/link/ports"));
      const j = await r.json();
      setPorts(j.ports ?? []);
      setBauds(j.baud_rates ?? [115200]);
      if (!device && j.ports?.length) setDevice(j.ports[0].device);
    } catch (err) {
      setResult({ ok: false, detail: `Could not list ports: ${err.message}` });
    } finally {
      setBusy(null);
    }
  }, [device]);

  useEffect(() => { scan(); /* eslint-disable-next-line */ }, []);

  // ── Link status polling ─────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const r = await fetch(api("/api/link/status"));
        const j = await r.json();
        if (alive) setStatus(j);
      } catch {
        if (alive) setStatus(null);
      }
    }
    poll();
    const id = setInterval(poll, 3000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  useEffect(() => {
    if (!connected) { setModes([]); return; }
    (async () => {
      try {
        const r = await fetch(api("/api/vehicle/modes"));
        const j = await r.json();
        setModes(j.modes ?? []);
        if (!mode && j.modes?.length) setMode(j.modes.includes("GUIDED") ? "GUIDED" : j.modes[0]);
      } catch { /* modes stay empty; the selector disables itself */ }
    })();
    // eslint-disable-next-line
  }, [connected]);

  function linkBody() {
    return linkType === "serial"
      ? { link_type: "serial", device, baud }
      : { link_type: linkType, host, port: Number(port), baud };
  }

  async function act(name, path, body, method = "POST") {
    setBusy(name);
    setResult(null);
    try {
      const r = await fetch(api(path), {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const j = await r.json().catch(() => ({}));
      setResult({
        ok: r.ok && j.ok !== false,
        detail: j.detail ?? (r.ok ? "Done" : `HTTP ${r.status}`),
        simulated: j.simulated,
      });
    } catch (err) {
      setResult({ ok: false, detail: err.message ?? "Request failed" });
    } finally {
      setBusy(null);
    }
  }

  const field = "w-full text-[12px] px-2 py-1.5 bg-white";
  const fieldStyle = { border: "1px solid var(--rule-strong)", borderRadius: 2 };

  return (
    <div className="panel flex flex-col overflow-hidden">
      <div className="panel-head">
        <h2 className="panel-title">Flight Controller</h2>
        {connected ? (
          <StatusPill tone="nominal" label="Connected" dot />
        ) : status?.suspended ? (
          <StatusPill tone="absent" label="Disconnected" />
        ) : (
          <StatusPill tone="critical" label="No Link" dot />
        )}
      </div>

      <div className="p-3 flex flex-col gap-2.5 overflow-y-auto scroll-thin">
        {/* What answered, so the operator knows it is the right aircraft */}
        {connected && status?.link?.system_id != null && (
          <div className="text-[10px] font-mono" style={{ color: "var(--ink-2)" }}>
            sys {status.link.system_id} · comp {status.link.component_id} ·{" "}
            {status.connection_string} @ {status.baud}
          </div>
        )}

        {/* Link type */}
        <div className="flex gap-1">
          {LINK_TYPES.map((t) => (
            <button
              key={t.id}
              onClick={() => setLinkType(t.id)}
              title={t.hint}
              className="pill flex-1 justify-center"
              style={linkType === t.id
                ? { background: "var(--ink)", borderColor: "var(--ink)", color: "#fff" }
                : undefined}
            >
              {t.label}
            </button>
          ))}
        </div>

        {linkType === "serial" ? (
          <>
            <label className="stat-label">Port</label>
            <div className="flex gap-1.5">
              <select
                className={field}
                style={fieldStyle}
                value={device}
                onChange={(e) => setDevice(e.target.value)}
              >
                {ports.length === 0 && <option value="">No serial ports found</option>}
                {ports.map((p) => (
                  <option key={p.device} value={p.device}>
                    {p.device}{p.likely_autopilot ? "  ★" : ""} — {p.description}
                  </option>
                ))}
              </select>
              <button className="btn" onClick={scan} disabled={busy === "scan"}>
                {busy === "scan" ? "…" : "Scan"}
              </button>
            </div>
            {ports.length === 0 && (
              <p className="notice">
                No serial ports detected. Connect the Pixhawk by USB, then press Scan.
                A ★ marks a likely autopilot.
              </p>
            )}
          </>
        ) : (
          <div className="flex gap-1.5">
            <div className="flex-1">
              <label className="stat-label">Host</label>
              <input className={field} style={fieldStyle} value={host}
                     onChange={(e) => setHost(e.target.value)} />
            </div>
            <div style={{ width: "6rem" }}>
              <label className="stat-label">Port</label>
              <input className={field} style={fieldStyle} value={port}
                     onChange={(e) => setPort(e.target.value)} />
            </div>
          </div>
        )}

        <div>
          <label className="stat-label">Baud</label>
          <select className={field} style={fieldStyle} value={baud}
                  onChange={(e) => setBaud(Number(e.target.value))}>
            {bauds.map((b) => (
              <option key={b} value={b}>
                {b}{b === 115200 ? "  (USB)" : b === 57600 ? "  (telemetry radio)" : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="flex gap-1.5">
          <button className="btn flex-1" disabled={!!busy}
                  onClick={() => act("test", "/api/link/test", linkBody())}>
            {busy === "test" ? "Testing…" : "Test"}
          </button>
          {connected ? (
            <button className="btn flex-1" disabled={!!busy}
                    onClick={() => act("disconnect", "/api/link/disconnect")}>
              {busy === "disconnect" ? "…" : "Disconnect"}
            </button>
          ) : (
            <button className="btn btn-primary flex-1" disabled={!!busy}
                    onClick={() => act("connect", "/api/link/connect", linkBody())}>
              {busy === "connect" ? "Connecting…" : "Connect"}
            </button>
          )}
        </div>

        {result && (
          <p className={result.ok ? "notice" : "notice-critical"}>
            {result.simulated ? "[SIMULATED] " : ""}{result.detail}
          </p>
        )}

        {/* ── Vehicle actions ── */}
        <div className="pt-1" style={{ borderTop: "1px solid var(--rule)" }}>
          <label className="stat-label">Vehicle</label>
        </div>

        <div className="flex gap-1.5">
          <select
            className={field}
            style={fieldStyle}
            value={mode}
            disabled={!modes.length}
            onChange={(e) => setMode(e.target.value)}
          >
            {!modes.length && <option value="">No modes — connect first</option>}
            {modes.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <button
            className="btn"
            disabled={!connected || !mode || !!busy}
            onClick={() => act("mode", "/api/vehicle/mode", { mode })}
          >
            Set
          </button>
        </div>

        <div className="flex gap-1.5">
          <button
            className="btn flex-1"
            disabled={!connected || !!busy}
            onClick={() => act("arm", "/api/vehicle/arm", { arm: true })}
            title="Arm the vehicle — the autopilot's pre-arm checks still apply"
          >
            {busy === "arm" ? "…" : "Arm"}
          </button>
          <button
            className="btn flex-1"
            disabled={!connected || !!busy}
            onClick={() => act("disarm", "/api/vehicle/arm", { arm: false })}
          >
            {busy === "disarm" ? "…" : "Disarm"}
          </button>
        </div>

        <button
          className="btn"
          disabled={!connected || waypointCount < 1 || !!busy}
          onClick={() => act("upload", "/api/vehicle/mission/upload", { altitude: 45 })}
          title={waypointCount < 1
            ? "Plan a route on the map first"
            : `Upload ${waypointCount} waypoints to the autopilot`}
        >
          {busy === "upload" ? "Uploading…" : `Upload Mission (${waypointCount} WP)`}
        </button>

        {!connected && (
          <p className="notice">
            Vehicle actions need a flight controller. Connect above, or press
            Demo in the header to run a simulated aircraft.
          </p>
        )}
      </div>
    </div>
  );
}
