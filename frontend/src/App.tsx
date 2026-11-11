import { AnimatePresence, MotionConfig } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import Alerts from "./pages/Alerts";
import Analytics from "./pages/Analytics";
import CommandCenter from "./pages/CommandCenter";
import Explain from "./pages/Explain";
import Explorer from "./pages/Explorer";
import ModelLab from "./pages/ModelLab";
import NotFound from "./pages/NotFound";
import Reports from "./pages/Reports";
import RiskEngine from "./pages/RiskEngine";
import Scanner from "./pages/Scanner";
import ScenarioLab from "./pages/ScenarioLab";
import Welcome from "./pages/Welcome";

const KEY = "tranziq-entered";
function alreadyEntered() {
  try { return sessionStorage.getItem(KEY) === "1"; } catch { return false; }
}

export default function App() {
  // The welcome story is shown once per browser session (and on demand via "Replay intro").
  const [entered, setEntered] = useState(alreadyEntered);
  const enter = useCallback(() => {
    try { sessionStorage.setItem(KEY, "1"); } catch { /* storage blocked */ }
    window.scrollTo({ top: 0 });
    setEntered(true);
  }, []);
  useEffect(() => {
    const replay = () => setEntered(false);
    window.addEventListener("tranziq:replay", replay);
    return () => window.removeEventListener("tranziq:replay", replay);
  }, []);

  return (
    // reducedMotion="user" -> respects the OS "reduce motion" accessibility setting
    <MotionConfig reducedMotion="user">
      <AnimatePresence>{!entered && <Welcome key="welcome" onEnter={enter} />}</AnimatePresence>
      {entered && (
        <Layout>
          <Routes>
            <Route path="/" element={<CommandCenter />} />
            <Route path="/scanner" element={<Scanner />} />
            <Route path="/models" element={<ModelLab />} />
            <Route path="/transactions" element={<Explorer />} />
            <Route path="/risk" element={<RiskEngine />} />
            <Route path="/explain" element={<Explain />} />
            <Route path="/scenarios" element={<ScenarioLab />} />
            <Route path="/synthetic" element={<Navigate to="/scenarios" replace />} />
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/analytics" element={<Analytics />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Layout>
      )}
    </MotionConfig>
  );
}
