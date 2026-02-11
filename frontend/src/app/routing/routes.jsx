import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";
import { Alert, Container, Nav } from "react-bootstrap";
import { useApp } from "../providers/AppProviders";
import { DashboardPage } from "../../pages/dashboard/DashboardPage";
import { PaperTestPage } from "../../pages/paper/PaperTestPage";
import { PresetsPage } from "../../pages/presets/PresetsPage";
import { RangeMetricsPage } from "../../pages/range/RangeMetricsPage";
import { BoundaryFlipPage } from "../../pages/boundary/BoundaryFlipPage";
import { RangeConfigPage } from "../../pages/range/RangeConfigPage";

function Layout({ children }) {
  const { uiError, setUiError } = useApp();
  const linkClass = ({ isActive }) => `nav-link ${isActive ? "active" : ""}`;
  return (
    <BrowserRouter>
      <Container fluid className="py-2">
        <div style={{ overflowX: "auto", whiteSpace: "nowrap" }}>
          <Nav variant="tabs" className="flex-nowrap">
            <NavLink to="/" end className={linkClass}>Главная</NavLink>
            <NavLink to="/paper" className={linkClass}>Тест (бумажный)</NavLink>
            <NavLink to="/presets" className={linkClass}>Пресеты</NavLink>
                        <NavLink to="/boundary-flip" className={linkClass}>Boundary Flip Bot</NavLink>
            <NavLink to="/range-metrics" className={linkClass}>Range Metrics</NavLink>
            <NavLink to="/range-config" className={linkClass}>Range Config</NavLink>
          </Nav>
        </div>
        {uiError && <Alert variant="danger" className="mt-2 py-2" dismissible onClose={() => setUiError("")}>{uiError}</Alert>}
        <div className="mt-3">{children}</div>
      </Container>
    </BrowserRouter>
  );
}

export function RoutesView() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/paper" element={<PaperTestPage />} />
        <Route path="/presets" element={<PresetsPage />} />
        <Route path="/boundary-flip" element={<BoundaryFlipPage />} />
        <Route path="/range-metrics" element={<RangeMetricsPage />} />
        <Route path="/range-config" element={<RangeConfigPage />} />
      </Routes>
    </Layout>
  );
}
