/**
 * Runtime configuration for the gridZERO frontend.
 *
 * The API base used to be hardcoded as "http://localhost:8000" in several
 * files, which meant the GCS could only ever be served from the same machine
 * as the backend. It is now driven by Vite env vars so the console can run on
 * an operator laptop talking to a backend on the aircraft's companion computer.
 *
 * Set in `frontend/.env.local` (or the shell) to override:
 *
 *   VITE_API_BASE=http://192.168.1.50:8000
 *
 * If unset we fall back to the page's own host on port 8000, which keeps the
 * default local workflow working and also does the right thing when the UI is
 * served from another machine.
 */

function resolveApiBase() {
  const configured = import.meta.env?.VITE_API_BASE;
  if (configured) return String(configured).replace(/\/+$/, "");

  if (typeof window !== "undefined" && window.location?.hostname) {
    const { protocol, hostname } = window.location;
    return `${protocol}//${hostname}:8000`;
  }
  return "http://localhost:8000";
}

export const API_BASE = resolveApiBase();

/** WebSocket URL derived from the API base, so both follow one setting. */
export const WS_URL =
  API_BASE.replace(/^http/, "ws") + "/ws";

/** Convenience: build an absolute API URL from a path. */
export function api(path) {
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}
