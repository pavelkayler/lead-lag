import { useEffect, useState } from "react";
import { Button, Card, Col, Row, Table } from "react-bootstrap";
import { useApp } from "../../app/providers/AppProviders";

export function TradingPage({ mode = "demo" }) {
  const app = useApp();
  const [params, setParams] = useState(() => JSON.parse(localStorage.getItem("llPreset") || '{"qtyUSDT":25,"minCorr":0.2,"stdBars":180,"impulseZ":6,"tpSigma":25,"slSigma":18,"maxHoldBars":240,"cooldownBars":40}'));
  const [orders, setOrders] = useState([]);

  useEffect(() => { const t = setInterval(async () => { try { const r = await app.getOpenOrders(); setOrders(r || []); } catch {} }, 5000); return () => clearInterval(t); }, []);

  return <Row className="g-3"><Col md={12}><Card body>
    <pre>{JSON.stringify(params, null, 2)}</pre>
    <div className="d-flex gap-2"><Button onClick={() => app.startTrading(mode, params)}>Запустить бота ({mode === "demo" ? "демо" : "реал"})</Button><Button variant="outline-danger" onClick={app.stopTrading}>Остановить</Button><Button variant="outline-secondary" onClick={app.getTradingStatus}>Обновить статус</Button></div>
    <div className="mt-2">Статус: {JSON.stringify(app.tradingStatus)}</div>
    <div className="mt-2 d-flex gap-2"><Button size="sm" onClick={app.cancelAllOrders}>Отменить все ордера</Button><Button size="sm" variant="outline-danger" onClick={app.closeAllPositions}>Закрыть все позиции</Button></div>
  </Card></Col>
  <Col md={12}><Card body><h6>Открытые ордера</h6><Table size="sm"><thead><tr><th>symbol</th><th>side</th><th>qty</th><th>orderLinkId</th></tr></thead><tbody>{orders.map((o,i)=><tr key={i}><td>{o.symbol}</td><td>{o.side}</td><td>{o.qty}</td><td>{o.orderLinkId}</td></tr>)}</tbody></Table></Card></Col></Row>;
}
