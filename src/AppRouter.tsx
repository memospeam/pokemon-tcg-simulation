import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/layout/AppShell";
import { BattlePage } from "@/pages/BattlePage";
import { DecksPage } from "@/pages/DecksPage";
import { AnalysisLab } from "@/components/Analysis/AnalysisLab";

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/battle" replace />} />
          <Route path="/battle" element={<BattlePage />} />
          <Route path="/decks" element={<DecksPage />} />
          <Route path="/analysis" element={<AnalysisLab />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
