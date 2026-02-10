import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";
import { Alert, Container, Nav } from "react-bootstrap";
import { useApp } from "../providers/AppProviders";
import { DashboardPage } from "../../pages/dashboard/DashboardPage";
import { PaperTestPage } from "../../pages/paper/PaperTestPage";
import { TradingPage } from "../../pages/trading/TradingPage";
import { HedgePage } from "../../pages/hedge/HedgePage";
import { HistoryPage } from "../../pages/history/HistoryPage";

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
            <NavLink to="/demo" className={linkClass}>Демо торговля</NavLink>
            <NavLink to="/real" className={linkClass}>Реальная торговля</NavLink>
            <NavLink to="/hedge" className={linkClass}>Хеджирование</NavLink>
            <NavLink to="/history" className={linkClass}>История</NavLink>
            <NavLink to="/arb" className={linkClass}>Арбитражный бот</NavLink>
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
        <Route path="/demo" element={<TradingPage mode="demo" />} />
        <Route path="/real" element={<TradingPage mode="real" />} />
        <Route path="/hedge" element={<HedgePage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/arb" element={<div>В разработке.</div>} />
      </Routes>
    </Layout>
  );
}
