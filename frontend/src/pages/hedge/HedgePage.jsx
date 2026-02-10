import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Col, Form, Row, Tab, Table, Tabs } from "react-bootstrap";
import { useApp } from "../../app/providers/AppProviders";

const FALLBACK_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];

export function HedgePage() {
  const app = useApp();
  const symbols = app.symbols?.length ? app.symbols : FALLBACK_SYMBOLS;
  const [symbol, setSymbol] = useState(symbols[0]);
  const [offsetPercent, setOffsetPercent] = useState(1);
  const [tp, setTp] = useState(1);
  const [sl, setSl] = useState(2);
  const [tpSlMode, setTpSlMode] = useState("roiPct");
  const [tab, setTab] = useState("orders");

  useEffect(() => { if (!symbols.includes(symbol)) setSymbol(symbols[0]); }, [symbols, symbol]);

  const refreshTradeState = async () => {
    await app.sendCommand("reconcileTradeState", {}).catch(() => {});
    await app.sendCommand("getTradeState", { maxOrders: 100, maxExecutions: 100 }).catch(() => {});
  };

  useEffect(() => {
    const t = setInterval(() => refreshTradeState(), 3000);
    return () => clearInterval(t);
  }, []);

  const bars = app.bars[symbol] || [];
  const stats = useMemo(() => {
    const v = bars.map((b) => Number(b.mid || b.close || 0)).filter(Boolean);
    if (!v.length) return null;
    const avg = v.reduce((a, b) => a + b, 0) / v.length;
    return { min: Math.min(...v), max: Math.max(...v), avg, vol: Math.sqrt(v.reduce((a, x) => a + (x - avg) ** 2, 0) / v.length) };
  }, [bars]);

  const openOrders = (app.tradeState?.openOrders || []);
  const positions = (app.tradeState?.positions || []);
  const executions = (app.tradeState?.executions || []);

  const tpLabel = tpSlMode === "roiPct" ? "TP (ROI %)" : "TP (PnL USDT)";
  const slLabel = tpSlMode === "roiPct" ? "SL (ROI %)" : "SL (PnL USDT)";
  const invalid = sl <= tp;

  return <Row className="g-3"><Col md={12}><Card body>
    <div className="d-flex gap-2 flex-wrap align-items-end">
      <div><Form.Label>Пара</Form.Label><Form.Select value={symbol} onChange={(e) => setSymbol(e.target.value)} style={{ maxWidth: 180 }}>{symbols.map((s) => <option key={s} value={s}>{s}</option>)}</Form.Select></div>
      <div><Form.Label>Offset (%)</Form.Label><Form.Control type="number" value={offsetPercent} onChange={(e) => setOffsetPercent(Number(e.target.value))} style={{ maxWidth: 130 }} /></div>
      <div><Form.Label>Режим TP/SL</Form.Label><Form.Select value={tpSlMode} onChange={(e) => setTpSlMode(e.target.value)} style={{ maxWidth: 180 }}><option value="roiPct">TP/SL по ROI (%)</option><option value="pnlUSDT">TP/SL по PnL (USDT)</option></Form.Select></div>
      <div><Form.Label>{tpLabel}</Form.Label><Form.Control type="number" value={tp} onChange={(e) => setTp(Number(e.target.value))} style={{ maxWidth: 130 }} /></div>
      <div><Form.Label>{slLabel}</Form.Label><Form.Control type="number" value={sl} onChange={(e) => setSl(Number(e.target.value))} style={{ maxWidth: 130 }} /></div>
      <Button disabled={invalid} onClick={() => app.createHedgeOrders({ symbol, offsetPercent, takeProfit: { type: tpSlMode, value: tp }, stopLoss: { type: tpSlMode, value: sl } }).catch(() => {})}>Открыть сделки</Button>
      <Button variant="outline-secondary" onClick={() => refreshTradeState().catch(() => {})}>Обновить</Button>
    </div>
    {invalid && <div className="text-danger mt-2">SL должен быть больше TP</div>}
    {app.uiError && <Alert variant="danger" className="py-1 mt-2 mb-0">{app.uiError}</Alert>}
  </Card></Col>
  <Col md={12}><Card body><h6>Статистика по паре</h6><Table size="sm" style={{ tableLayout: "fixed" }}><tbody>{stats && Object.entries(stats).map(([k, v]) => <tr key={k}><td style={{ width: "40%" }}>{k}</td><td style={{ width: "60%", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{Number(v).toFixed(4)}</td></tr>)}</tbody></Table></Card></Col>
  <Col md={12}><Card body>
    <Tabs activeKey={tab} onSelect={(k) => setTab(k || "orders")}>
      <Tab eventKey="orders" title={`Открытые ордера (${openOrders.length})`}><div style={{ maxHeight: 260, overflowY: "auto" }}><Table size="sm"><thead><tr><th>symbol</th><th>side</th><th>qty</th><th>price</th></tr></thead><tbody>{openOrders.map((o, i) => <tr key={i}><td>{o.symbol}</td><td>{o.side}</td><td>{o.qty || o.leavesQty}</td><td>{o.price || o.triggerPrice}</td></tr>)}</tbody></Table></div></Tab>
      <Tab eventKey="positions" title={`Позиции (${positions.length})`}><div style={{ maxHeight: 260, overflowY: "auto" }}><Table size="sm"><thead><tr><th>symbol</th><th>side</th><th>size</th><th>entryPrice</th><th>unrealisedPnl</th></tr></thead><tbody>{positions.map((p, i) => <tr key={i}><td>{p.symbol}</td><td>{p.side}</td><td>{p.size}</td><td>{p.entryPrice}</td><td>{p.unrealisedPnl}</td></tr>)}</tbody></Table></div></Tab>
      <Tab eventKey="history" title={`История (${executions.length})`}><div style={{ maxHeight: 260, overflowY: "auto" }}><Table size="sm"><thead><tr><th>symbol</th><th>side</th><th>execQty</th><th>execPrice</th><th>execTime</th></tr></thead><tbody>{executions.map((e, i) => <tr key={i}><td>{e.symbol}</td><td>{e.side}</td><td>{e.execQty}</td><td>{e.execPrice}</td><td>{e.execTime ? new Date(Number(e.execTime)).toLocaleTimeString("ru-RU") : "-"}</td></tr>)}</tbody></Table></div></Tab>
    </Tabs>
  </Card></Col></Row>;
}
