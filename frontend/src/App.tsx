import { AnimatePresence, MotionConfig } from "framer-motion";
import { useCallback, useState } from "react";
import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { LoadingScreen } from "./components/LoadingScreen";
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
import Synthetic from "./pages/Synthetic";

function shouldShowIntro() {
  try {
    return sessionStorage.getItem("tranziq-booted") !== "1";
  } catch {
    return true;
  }
}

export default function App() {
  const [booting, setBooting] = useState(shouldShowIntro);
  const done = useCallback(() => {
    try { sessionStorage.setItem("tranziq-booted", "1"); } catch { /* ignore */ }
    setBooting(false);
  }, []);

  return (
    // reducedMotion="user" -> respects the OS "reduce motion" accessibility setting
    <MotionConfig reducedMotion="user">
      <AnimatePresence>{booting && <LoadingScreen key="boot" onDone={done} />}</AnimatePresence>
      <Layout>
        <Routes>
          <Route path="/" element={<CommandCenter />} />
          <Route path="/scanner" element={<Scanner />} />
          <Route path="/models" element={<ModelLab />} />
          <Route path="/transactions" element={<Explorer />} />
          <Route path="/risk" element={<RiskEngine />} />
          <Route path="/explain" element={<Explain />} />
          <Route path="/synthetic" element={<Synthetic />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Layout>
    </MotionConfig>
  );
}
