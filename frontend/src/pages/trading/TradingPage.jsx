import { useEffect, useState } from "react";
import { Button, Card, Col, Row, Tab, Table, Tabs } from "react-bootstrap";
import { useApp } from "../../app/providers/AppProviders";

export function TradingPage({ mode = "demo" }) {
  const app = useApp();
  const [params] = useState(() => JSON.parse(localStorage.getItem("llPreset") || '{"qtyUSDT":25,"minCorr":0.2,"stdBars":180,"impulseZ":6,"tpSigma":25,"slSigma":18,"maxHoldBars":240,"cooldownBars":40}'));
  const [tab, setTab] = useState("orders");

  const openOrders = app.tradeState?.openOrders || [];
  const positions = app.tradeState?.positions || [];

  useEffect(() => {
    const t = setInterval(async () => {
      try { await app.getOpenOrders(); } catch (e) { void e; }
    }, 15000);
    return () => clearInterval(t);
  }, [app]);

  return <Row className="g-3"><Col md={12}><Card body>
    <pre>{JSON.stringify(params, null, 2)}</pre>
    <div className="d-flex gap-2"><Button onClick={() => app.startTrading(mode, params).catch(() => {})}>Запустить бота ({mode === "demo" ? "демо" : "реал"})</Button><Button variant="outline-danger" onClick={() => app.stopTrading().catch(() => {})}>Остановить</Button><Button variant="outline-secondary" onClick={() => app.getTradingStatus().catch(() => {})}>Обновить статус</Button></div>
    <div className="mt-2">Статус: {JSON.stringify(app.tradingStatus)}</div>
    <div className="mt-2 d-flex gap-2"><Button size="sm" onClick={() => app.cancelAllOrders().catch(() => {})}>Отменить все ордера</Button><Button size="sm" variant="outline-danger" onClick={() => app.closeAllPositions().catch(() => {})}>Закрыть все позиции</Button></div>
  </Card></Col>
  <Col md={12}><Card body>
    <Tabs activeKey={tab} onSelect={(k) => setTab(k || "orders")}>
      <Tab eventKey="orders" title={`Открытые ордера (${openOrders.length})`}>
        <div style={{ maxHeight: 260, overflowY: "auto" }}>
          <Table size="sm"><thead><tr><th>symbol</th><th>side</th><th>qty</th><th>orderLinkId</th></tr></thead><tbody>{openOrders.map((o,i)=><tr key={i}><td>{o.symbol}</td><td>{o.side}</td><td>{o.qty}</td><td>{o.orderLinkId}</td></tr>)}</tbody></Table>
        </div>
      </Tab>
      <Tab eventKey="positions" title={`Позиции (${positions.length})`}>
        <div style={{ maxHeight: 260, overflowY: "auto" }}>
          <Table size="sm"><thead><tr><th>symbol</th><th>side</th><th>size</th><th>entryPrice</th><th>unrealisedPnl</th></tr></thead><tbody>{positions.map((p,i)=><tr key={i}><td>{p.symbol}</td><td>{p.side}</td><td>{p.size}</td><td>{p.entryPrice}</td><td>{p.unrealisedPnl}</td></tr>)}</tbody></Table>
        </div>
      </Tab>
    </Tabs>
  </Card></Col></Row>;
}
