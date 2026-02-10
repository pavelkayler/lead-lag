import { useMemo, useState } from "react";
import { Button, Card, Col, Form, Row, Table } from "react-bootstrap";
import { useApp } from "../../app/providers/AppProviders";

function ResponsiveChart({ points = [] }) {
  const [w, h] = ["100%", 220];
  const vals = points.map((p) => Number(p.mid || p.close || 0)).filter((n) => Number.isFinite(n) && n > 0);
  if (!vals.length) return <div>Нет данных</div>;
  const min = Math.min(...vals); const max = Math.max(...vals); const span = Math.max(1e-9, max - min);
  const path = vals.map((v, i) => `${(i / Math.max(1, vals.length - 1)) * 1000},${200 - ((v - min) / span) * 180}`).join(" ");
  return <svg viewBox="0 0 1000 220" width={w} height={h}><polyline fill="none" stroke="#0d6efd" strokeWidth="2" points={path} /><text x="6" y="14">min {min.toFixed(4)}</text><text x="6" y="214">max {max.toFixed(4)}</text></svg>;
}

export function DashboardPage() {
  const app = useApp();
  const [symbolsText, setSymbolsText] = useState("BTCUSDT,ETHUSDT,SOLUSDT");
  const [chartSymbol, setChartSymbol] = useState("BTCUSDT");

  const rows = useMemo(() => Object.values(app.prices || {}), [app.prices]);
  const top = useMemo(() => (app.leadlag || []).slice(0, 10), [app.leadlag]);

  return <Row className="g-3">
    <Col md={12}><Card body>
      <Form.Group className="mb-2"><Form.Label>WS URL</Form.Label><Form.Control value={app.wsUrl} onChange={(e) => app.setWsUrl(e.target.value)} /></Form.Group>
      <div className="d-flex gap-2 align-items-center flex-wrap">
        <Button onClick={app.connect}>Подключиться</Button><Button variant="outline-secondary" onClick={app.disconnect}>Отключиться</Button>
        <span>Статус: <b>{app.status}</b> / ClientId: {app.clientId || "-"}</span>
      </div>
    </Card></Col>
    <Col md={12}><Card body><Form.Label>Символы ({app.symbols.length}/{app.feedMaxSymbols})</Form.Label>
      <div className="d-flex gap-2"><Form.Control value={symbolsText} onChange={(e) => setSymbolsText(e.target.value)} /><Button onClick={() => app.setSymbols(symbolsText.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean))}>Применить</Button><Button onClick={app.startFeed}>Старт фид</Button><Button variant="outline-danger" onClick={app.stopFeed}>Стоп фид</Button></div>
      <div className="mt-2 d-flex gap-3 flex-wrap">{["price","bar","leadlag","metrics","tradeState","paperTest"].map((t) => <Form.Check key={t} type="checkbox" label={t} onChange={(e) => e.target.checked ? app.subscribe(t) : app.unsubscribe(t)} />)}</div>
    </Card></Col>
    <Col lg={6}><Card body><h6>Цены</h6><Table size="sm"><thead><tr><th>Symbol</th><th>Mid</th></tr></thead><tbody>{rows.map((r) => <tr key={r.symbol}><td>{r.symbol}</td><td>{Number(r.mid || r.price || 0).toFixed(6)}</td></tr>)}</tbody></Table></Card></Col>
    <Col lg={6}><Card body><h6>Лид-лаг</h6><Table size="sm"><thead><tr><th>Leader</th><th>Follower</th><th>Corr</th></tr></thead><tbody>{top.map((r, i) => <tr key={i}><td>{r.leader}</td><td>{r.follower}</td><td>{Number(r.corr || 0).toFixed(3)}</td></tr>)}</tbody></Table></Card></Col>
    <Col md={12}><Card body><h6>Метрики</h6><pre style={{ margin: 0 }}>{JSON.stringify(app.metrics?.feed || {}, null, 2)}</pre></Card></Col>
    <Col md={12}><Card body><div className="d-flex gap-2 mb-2"><Form.Control value={chartSymbol} onChange={(e) => setChartSymbol(e.target.value.toUpperCase())} style={{ maxWidth: 180 }} /></div><ResponsiveChart points={app.bars?.[chartSymbol] || []} /></Card></Col>
  </Row>;
}
