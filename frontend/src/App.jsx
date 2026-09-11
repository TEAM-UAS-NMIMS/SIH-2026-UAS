import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { TelemetryProvider } from "./context/TelemetryContext";
import RootLayout from "./layouts/RootLayout";
import LiveRescueScreen from "./screens/LiveRescueScreen";
import PreFlightScreen from "./screens/PreFlightScreen";
import AnalysisScreen from "./screens/AnalysisScreen";
import ReportScreen from "./screens/ReportScreen";

export default function App() {
  return (
    <TelemetryProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<RootLayout />}>
            <Route index element={<Navigate to="/preflight" replace />} />
            <Route path="preflight" element={<PreFlightScreen />} />
            <Route path="live" element={<LiveRescueScreen />} />
            <Route path="analysis" element={<AnalysisScreen />} />
            <Route path="report" element={<ReportScreen />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </TelemetryProvider>
  );
}
