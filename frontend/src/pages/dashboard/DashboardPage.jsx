import { useEffect, useMemo, useState } from "react";
import { Button, Card, Col, Form, Row, Table } from "react-bootstrap";
import { useApp } from "../../app/providers/AppProviders";

const TOPICS = ["price", "bar", "leadlag", "metrics", "tradeState", "paperTest"];

export function DashboardPage() {
  const app = useApp();
  const [symbolsText, setSymbolsText] = useState("");
  const [subs, setSubs] = useState(() => Object.fromEntries(TOPICS.map((t) => [t, true])));

  const symbolCount = useMemo(() => symbolsText.split(",").map((s) => s.trim()).filter(Boolean).length, [symbolsText]);

  useEffect(() => {
    if (app.status !== "connected" || symbolsText) return;
    app.sendCommand("getSymbolsFromRating", { limit: 300, minCapUsd: 10_000_000 }).then((res) => setSymbolsText((res?.symbols || []).join(","))).catch(() => {});
  }, [app.status, symbolsText, app]);

  const rows = useMemo(() => Object.values(app.prices || {}).sort((a, b) => String(a.symbol || "").localeCompare(String(b.symbol || ""))), [app.prices]);
  const top = useMemo(() => [...(app.leadlag || [])].slice(0, 10), [app.leadlag]);

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
    <Col lg={6}><Card body><h6>Цены</h6><div style={{ maxHeight: 330, overflowY: "auto" }}><Table size="sm"><thead><tr><th>Symbol</th><th>Mid</th></tr></thead><tbody>{rows.map((r) => <tr key={r.symbol}><td>{r.symbol}</td><td style={{ fontVariantNumeric: "tabular-nums" }}>{Number(r.mid || r.price || 0).toFixed(6)}</td></tr>)}</tbody></Table></div></Card></Col>
    <Col lg={6}><Card body><h6>Лид-лаг (TOP-10)</h6><Table size="sm"><thead><tr><th>Leader</th><th>Follower</th><th>Корреляция</th><th>Lag</th><th>Подтверждение</th></tr></thead><tbody>{top.map((r, i) => <tr key={i}><td>{r.leader}</td><td>{r.follower}</td><td style={{ fontVariantNumeric: "tabular-nums" }}>{Number(r.corr || 0).toFixed(3)}</td><td className="text-nowrap" style={{ fontVariantNumeric: "tabular-nums" }}>{Number(r.lagMs || 0)}ms / {Number(r.lagBars || 0)}б</td><td><b>{r.confirmLabel || "NO_DATA"}</b></td></tr>)}</tbody></Table></Card></Col>
  </Row>;
}
