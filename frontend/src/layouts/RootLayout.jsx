import { Outlet } from "react-router-dom";
import StatusBar from "../components/StatusBar";

/**
 * RootLayout wraps every route.
 * StatusBar is rendered OUTSIDE the Outlet so it persists unchanged
 * regardless of which route is active.
 */
export default function RootLayout() {
  return (
    <div className="h-screen flex flex-col overflow-hidden bg-slate-100">
      <StatusBar />
      <div className="flex-1 min-h-0 overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}
