import { useEffect, useState } from "react";
import { Badge, Button, Card, Col, Form, ProgressBar, Row, Table, Tab, Tabs, Toast, ToastContainer } from "react-bootstrap";
import { useApp } from "../../app/providers/AppProviders";

function fmtDurationBySec(secRaw) {
  const sec = Math.max(0, Math.floor(Number(secRaw) || 0));
  const h = String(Math.floor(sec / 3600)).padStart(2, "0");
  const m = String(Math.floor((sec % 3600) / 60)).padStart(2, "0");
  const s = String(sec % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

export function PaperTestPage() {
  const app = useApp();
  const [durationHours, setDurationHours] = useState(1);
  const [exploitBest, setExploitBest] = useState(true);
  const [isolatedPresetName, setIsolatedPresetName] = useState("");
  const [useBybit, setUseBybit] = useState(true);
  const [useBinance, setUseBinance] = useState(true);
  const [showToast, setShowToast] = useState(false);
  const [tick, setTick] = useState(0);

  const presets = app.presets || [];

  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const learning = app.paperTest?.learning || {};
  const summary = app.paperTest?.summary || {};
  const learningState = learning.state || app.paperTest?.state || "STOPPED";
  const isRunning = learningState === "RUNNING" || learningState === "RUNNING_WAITING" || learningState === "RUNNING_IN_TRADE";

  const startedAt = Number(summary.startedAt || app.paperTest?.startedAt || 0);
  const endsAt = Number(summary.endsAt || app.paperTest?.endsAt || 0);
  const now = Date.now() + tick * 0;
  const durationSec = isRunning
    ? (startedAt ? Math.max(0, (now - startedAt) / 1000) : 0)
    : (startedAt && endsAt ? Math.max(0, (endsAt - startedAt) / 1000) : Number(summary.durationSec || 0));

  const start = async () => {
    const res = await app.startPaperTest({ durationHours, rotateEveryMinutes: 60, symbolsCount: 100, minMarketCapUsd: 10_000_000, multiStrategy: false, exploitBest, testOnlyPresetName: isolatedPresetName || null, useBybit, useBinance });
    if (res?.queued) setShowToast(true);
  };

  const openOrders = app.tradeState?.openOrders || [];
  const positions = app.tradeState?.positions || [];
  const executions = app.tradeState?.executions || [];

  const detailRows = Object.entries(summary).filter(([k, v]) => !["endsAt", "startingBalanceUSDT", "equityUSDT", "trades", "wins", "losses", "netPnlUSDT", "startedAt", "durationSec", "perPreset"].includes(k) && typeof v !== "object");

  return <>
    <ToastContainer position="top-end" className="p-2"><Toast bg="success" delay={1200} show={showToast} autohide onClose={() => setShowToast(false)}><Toast.Body className="text-white">Тест поставлен в очередь и запускается в фоне</Toast.Body></Toast></ToastContainer>
    <Row className="g-3">
      <Col md={12}><Card body>
        <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2"><h6 className="mb-0">Paper Test</h6><Badge bg={isRunning ? "success" : "secondary"}>{isRunning ? "Тест запущен" : "Тест остановлен"}</Badge></div>
        <Form.Label className="mb-1">Длительность (часы): {durationHours}</Form.Label><Form.Range min={1} max={24} value={durationHours} onChange={(e) => setDurationHours(Number(e.target.value))} />
        <div className="mb-2"><Form.Check type="checkbox" label="Эксплуатация лучшего" checked={exploitBest} onChange={(e) => setExploitBest(e.target.checked)} /></div>
        <div className="mb-2 d-flex gap-3 flex-wrap"><Form.Check type="checkbox" label="Use Bybit (BT)" checked={useBybit} onChange={(e) => setUseBybit(e.target.checked)} /><Form.Check type="checkbox" label="Use Binance (BNB)" checked={useBinance} onChange={(e) => setUseBinance(e.target.checked)} /></div>
        <Form.Group className="mb-2"><Form.Label>Тестировать только</Form.Label><Form.Select value={isolatedPresetName} onChange={(e) => setIsolatedPresetName(e.target.value)} style={{ maxWidth: 340 }}><option value="">Все пресеты (обычный режим)</option>{presets.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}</Form.Select></Form.Group>
        <div className="d-flex gap-2 flex-wrap"><Button onClick={() => start().catch(() => {})}>Запустить тест</Button><Button variant="outline-danger" onClick={() => app.stopPaperTest().catch(() => {})}>Остановить</Button><Button variant="outline-secondary" onClick={() => app.sendCommand("resetLearning", {}).catch(() => {})}>Сбросить историю</Button></div>
      </Card></Col>

      <Col md={12}><Card body><h6 className="mb-2">Сводка</h6>
        <Tabs defaultActiveKey="short">
          <Tab eventKey="short" title="Кратко"><Table size="sm" style={{ tableLayout: "fixed" }}><tbody style={{ fontVariantNumeric: "tabular-nums" }}>
            <tr><td style={{ width: "38%" }}>Время окончания</td><td>{isRunning ? "в процессе" : (endsAt ? new Date(endsAt).toLocaleString("ru-RU") : "-")}</td></tr>
            <tr><td>Длительность</td><td>{fmtDurationBySec(durationSec)}</td></tr>
            <tr><td>Нач. баланс</td><td>{Number(summary.startingBalanceUSDT || 0).toFixed(2)} USDT</td></tr>
            <tr><td>Эквити</td><td>{Number(summary.equityUSDT || 0).toFixed(2)} USDT</td></tr>
            <tr><td>Сделки</td><td>{summary.trades || 0}</td></tr>
            <tr><td>Победы</td><td>{summary.wins || 0}</td></tr>
            <tr><td>Поражения</td><td>{summary.losses || 0}</td></tr>
            <tr><td>Чистый PnL</td><td>{Number(summary.netPnlUSDT || 0).toFixed(2)} USDT</td></tr>
          </tbody></Table></Tab>
          <Tab eventKey="detail" title="Детально"><Table size="sm" style={{ tableLayout: "fixed" }}><tbody style={{ fontVariantNumeric: "tabular-nums" }}>{detailRows.map(([k, v]) => <tr key={k}><td style={{ width: "38%" }}>{k}</td><td>{typeof v === "number" ? v.toFixed(4) : String(v)}</td></tr>)}</tbody></Table></Tab>
        </Tabs>
      </Card></Col>

      <Col md={12}><Card body>
        <h6 className="mb-2">Обучение / Рекомендации</h6>
        <div className="small mb-1">Тест: <b>{isRunning ? "запущен" : "остановлен"}</b> • Статус: <b>{learningState}</b></div>
        <ProgressBar className="mb-2" striped={learningState === "RUNNING_WAITING"} animated={learningState === "RUNNING_WAITING"} variant={learningState === "RUNNING_IN_TRADE" ? "success" : "info"} now={learningState === "RUNNING_IN_TRADE" ? 100 : (isRunning ? 50 : 0)} />
        <div style={{ height: 220, minHeight: 220, resize: "vertical", overflowY: "auto", border: "1px solid rgba(0,0,0,0.1)", borderRadius: 8, padding: 8, background: "#fff" }}>
          {(learning.log || []).length ? (learning.log || []).slice().reverse().map((line, idx) => <div className="small" key={idx}>{line}</div>) : <div className="small text-muted">Лог пока пуст.</div>}
        </div>
      </Card></Col>

      <Col md={12}><Card body>
        <h6>Ордера / Позиции / История</h6>
        <Tabs defaultActiveKey="orders">
          <Tab eventKey="orders" title={`Открытые ордера (${openOrders.length})`}><Table size="sm"><thead><tr><th>Пара</th><th>Сторона</th><th>Qty</th><th>Статус</th></tr></thead><tbody>{openOrders.map((o, i) => <tr key={i}><td>{o.symbol}</td><td>{o.side}</td><td>{o.qty || o.leavesQty}</td><td>{o.orderStatus || o.order_status || "-"}</td></tr>)}</tbody></Table></Tab>
          <Tab eventKey="positions" title={`Позиции (${positions.length})`}><Table size="sm"><thead><tr><th>Пара</th><th>Сторона</th><th>Размер</th><th>PnL</th></tr></thead><tbody>{positions.map((p, i) => <tr key={i}><td>{p.symbol}</td><td>{p.side}</td><td>{p.size}</td><td>{p.unrealisedPnl}</td></tr>)}</tbody></Table></Tab>
          <Tab eventKey="history" title={`История (${executions.length})`}><Table size="sm"><thead><tr><th>Время</th><th>Пара</th><th>Сторона</th><th>Qty</th><th>Цена</th></tr></thead><tbody>{executions.slice(0, 150).map((t, i) => <tr key={i}><td>{t.execTime ? new Date(Number(t.execTime)).toLocaleTimeString("ru-RU") : "-"}</td><td>{t.symbol}</td><td>{t.side}</td><td>{t.execQty}</td><td style={{ fontVariantNumeric: "tabular-nums" }}>{Number(t.execPrice || 0).toFixed(4)}</td></tr>)}</tbody></Table></Tab>
        </Tabs>
      </Card></Col>
    </Row>
  </>;
}
