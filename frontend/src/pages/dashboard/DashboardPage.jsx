import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Col, Form, Row, Table } from "react-bootstrap";
import { useApp } from "../../app/providers/AppProviders";

const TOPICS = ["price", "bar", "leadlag", "metrics", "tradeState", "paperTest"];
const TIMEFRAMES = ["5m", "15m", "1h", "4h"];

function fmt(n, d = 4) { return Number.isFinite(Number(n)) ? Number(n).toFixed(d) : "-"; }

function CandleChart({ bars = [] }) {
  const [hover, setHover] = useState(null);
  const [start, setStart] = useState(0);
  const [count, setCount] = useState(80);

  useEffect(() => { setStart(Math.max(0, bars.length - count)); }, [bars.length, count]);
  const visible = bars.slice(start, start + count);
  const lo = Math.min(...visible.map((b) => b.low));
  const hi = Math.max(...visible.map((b) => b.high));
  const volMax = Math.max(...visible.map((b) => b.volume || 0), 1);
  const w = 1200;
  const h = 360;
  const priceH = 260;
  const volH = 80;
  const pad = 40;
  const span = Math.max(1e-9, hi - lo);
  const cw = Math.max(2, (w - pad * 2) / Math.max(1, visible.length));

  const yPrice = (v) => pad + ((hi - v) / span) * (priceH - 20);
  const xAt = (i) => pad + i * cw + cw * 0.5;

  const onWheel = (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      setCount((c) => Math.max(20, Math.min(200, c + (e.deltaY > 0 ? 10 : -10))));
      return;
    }
    setStart((s) => Math.max(0, Math.min(Math.max(0, bars.length - count), s + (e.deltaY > 0 ? 5 : -5))));
  };

  if (!visible.length) return <div className="text-muted">Нет свечей.</div>;

  return <div>
    <div className="small text-muted mb-1">Ctrl+scroll: zoom, scroll: move</div>
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} style={{ border: "1px solid #dee2e6", borderRadius: 8, background: "#fff" }} onWheel={onWheel} onMouseLeave={() => setHover(null)}>
      {visible.map((b, i) => {
        const x = xAt(i);
        const openY = yPrice(b.open);
        const closeY = yPrice(b.close);
        const highY = yPrice(b.high);
        const lowY = yPrice(b.low);
        const up = b.close >= b.open;
        const color = up ? "#16a34a" : "#dc2626";
        const bodyY = Math.min(openY, closeY);
        const bodyH = Math.max(1, Math.abs(openY - closeY));
        const volHeight = ((b.volume || 0) / volMax) * volH;
        return <g key={b.t} onMouseMove={() => setHover(b)}>
          <line x1={x} x2={x} y1={highY} y2={lowY} stroke={color} strokeWidth="1" />
          <rect x={x - cw * 0.35} y={bodyY} width={Math.max(1, cw * 0.7)} height={bodyH} fill={color} opacity="0.9" />
          <rect x={x - cw * 0.35} y={h - 20 - volHeight} width={Math.max(1, cw * 0.7)} height={volHeight} fill={color} opacity="0.35" />
        </g>;
      })}
    </svg>
    {hover && <div className="small mt-2" style={{ fontVariantNumeric: "tabular-nums" }}>
      O: <b>{fmt(hover.open, 4)} USDT</b> · H: <b>{fmt(hover.high, 4)} USDT</b> · L: <b>{fmt(hover.low, 4)} USDT</b> · C: <b>{fmt(hover.close, 4)} USDT</b> · V: <b>{fmt(hover.volume, 2)}</b>
    </div>}
  </div>;
}

export function DashboardPage() {
  const app = useApp();
  const [symbolsText, setSymbolsText] = useState("");
  const [chartSymbol, setChartSymbol] = useState("");
  const [timeframe, setTimeframe] = useState("15m");
  const [chartBars, setChartBars] = useState([]);
  const [subs, setSubs] = useState(() => Object.fromEntries(TOPICS.map((t) => [t, true])));

  const symbolCount = useMemo(() => symbolsText.split(",").map((s) => s.trim()).filter(Boolean).length, [symbolsText]);

  useEffect(() => {
    if (!app.symbols?.length) return;
    if (!chartSymbol || !app.symbols.includes(chartSymbol)) setChartSymbol(app.symbols[0]);
  }, [app.symbols, chartSymbol]);

  useEffect(() => {
    if (!chartSymbol || app.status !== "connected") return;
    app.sendCommand("getKlines", { symbol: chartSymbol, timeframe, limit: 220 }).then((res) => setChartBars(res?.bars || [])).catch(() => setChartBars([]));
  }, [app, chartSymbol, timeframe, app.status]);

  useEffect(() => {
    if (app.status !== "connected" || symbolsText) return;
    app.sendCommand("getSymbolsFromRating", { limit: 300, minCapUsd: 10_000_000 }).then((res) => setSymbolsText((res?.symbols || []).join(","))).catch(() => {});
  }, [app.status, symbolsText]);

  const rows = useMemo(() => Object.values(app.prices || {}), [app.prices]);
  const top = useMemo(() => [...(app.leadlag || [])].sort((a, b) => Number(b.corr || 0) - Number(a.corr || 0)).slice(0, 10), [app.leadlag]);

  const onToggleSub = async (topic, checked) => {
    setSubs((prev) => ({ ...prev, [topic]: checked }));
    if (checked) await app.subscribe(topic); else await app.unsubscribe(topic);
  };

  const onApplySymbols = async () => {
    const list = symbolsText.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 300);
    await app.setSymbols(list);
    setSymbolsText(list.join(","));
  };

  return <Row className="g-3">
    <Col md={12}><Card body>
      <Form.Group className="mb-2"><Form.Label>WS URL</Form.Label><Form.Control value={app.wsUrl} onChange={(e) => app.setWsUrl(e.target.value)} /></Form.Group>
      <div className="d-flex gap-2 align-items-center flex-wrap"><Button onClick={app.connect}>Подключиться</Button><Button variant="outline-secondary" onClick={app.disconnect}>Отключиться</Button><span>Статус: <b>{app.status}</b> / ClientId: {app.clientId || "-"}</span></div>
    </Card></Col>
    <Col md={12}><Card body><Form.Label>Символы ({symbolCount}/300)</Form.Label>
      <div className="d-flex gap-2 flex-wrap"><Form.Control value={symbolsText} onChange={(e) => { setSymbolsText(e.target.value); }} /><Button onClick={() => onApplySymbols().catch(() => {})}>Применить</Button><Button variant="outline-primary" onClick={() => app.sendCommand("getSymbolsFromRating", { limit: 300, minCapUsd: 10_000_000 }).then((res) => setSymbolsText((res?.symbols || []).join(","))).catch(() => {})}>Из рейтинга</Button><Button onClick={app.startFeed}>Старт фид</Button><Button variant="outline-danger" onClick={app.stopFeed}>Стоп фид</Button></div>
      <div className="mt-2 d-flex gap-3 flex-wrap">{TOPICS.map((t) => <Form.Check key={t} type="checkbox" label={t} checked={!!subs[t]} onChange={(e) => onToggleSub(t, e.target.checked)} />)}</div>
    </Card></Col>
    <Col lg={6}><Card body><h6>Цены</h6><div style={{ height: 360, overflowY: "auto" }}><Table size="sm"><thead><tr><th>Symbol</th><th>Mid</th></tr></thead><tbody>{rows.map((r) => <tr key={r.symbol}><td>{r.symbol}</td><td style={{ fontVariantNumeric: "tabular-nums" }}>{Number(r.mid || r.price || 0).toFixed(6)}</td></tr>)}</tbody></Table></div></Card></Col>
    <Col lg={6}><Card body><h6>Лид-лаг (TOP-10)</h6><Table size="sm"><thead><tr><th>Leader</th><th>Follower</th><th>Corr</th></tr></thead><tbody>{top.map((r, i) => <tr key={i}><td>{r.leader}</td><td>{r.follower}</td><td style={{ fontVariantNumeric: "tabular-nums" }}>{Number(r.corr || 0).toFixed(3)}</td></tr>)}</tbody></Table></Card></Col>
    <Col md={12}><Card body><div className="d-flex gap-2 mb-2 flex-wrap"><Form.Select value={chartSymbol} onChange={(e) => setChartSymbol(e.target.value)} style={{ maxWidth: 240 }}>{(app.symbols || []).map((s) => <option key={s} value={s}>{s}</option>)}</Form.Select>{TIMEFRAMES.map((tf) => <Button key={tf} size="sm" variant={timeframe === tf ? "primary" : "outline-secondary"} onClick={() => setTimeframe(tf)}>{tf}</Button>)}</div><CandleChart bars={chartBars} /></Card></Col>
  </Row>;
}
