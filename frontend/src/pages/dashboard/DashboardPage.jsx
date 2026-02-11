import { useEffect, useMemo, useState } from "react";
import { Button, Card, Col, Form, Row, Table } from "react-bootstrap";
import { useApp } from "../../app/providers/AppProviders";

const TOPICS = ["price", "leadlag", "metrics", "feedStatus"];
const TOP_HEIGHT = 360;

export function DashboardPage() {
  const app = useApp();
  const [symbolsText, setSymbolsText] = useState("");
  const [subs, setSubs] = useState(() => Object.fromEntries(TOPICS.map((t) => [t, true])));
  const [sort, setSort] = useState({ key: "corr", dir: "desc" });

  const symbolCount = useMemo(() => symbolsText.split(",").map((s) => s.trim()).filter(Boolean).length, [symbolsText]);

  useEffect(() => {
    if (app.status !== "connected" || symbolsText) return;
    app.sendCommand("getSymbolsFromRating", { limit: 100, minCapUsd: 10_000_000 }).then((res) => setSymbolsText((res?.symbols || []).join(","))).catch(() => {});
  }, [app.status, symbolsText, app]);

  const rows = useMemo(() => Object.values(app.prices || {}).sort((a, b) => String(a.symbol || "").localeCompare(String(b.symbol || ""))), [app.prices]);
  const top = useMemo(() => {
    const base = [...(app.leadlag || [])].slice(0, 100);
    const m = { leader: "leaderDisplay", follower: "followerDisplay", corr: "corr", lag: "lagMs", confirm: "confirmLabel" };
    const key = m[sort.key] || "corr";
    const dir = sort.dir === "asc" ? 1 : -1;
    return base.sort((a, b) => {
      const av = a?.[key];
      const bv = b?.[key];
      if (typeof av === "number" || typeof bv === "number") return (Number(av || 0) - Number(bv || 0)) * dir;
      return String(av || "").localeCompare(String(bv || "")) * dir;
    });
  }, [app.leadlag, sort]);
  const bnHealth = app.metrics?.feed?.binance || app.feedStatus?.binance || null;
  const bnState = bnHealth?.status || (bnHealth?.wsUp ? "OK" : "DOWN");

  const onToggleSub = async (topic, checked) => {
    setSubs((prev) => ({ ...prev, [topic]: checked }));
    if (checked) await app.subscribe(topic); else await app.unsubscribe(topic);
  };

  const onApplySymbols = async () => {
    const list = symbolsText.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 100);
    await app.setSymbols(list);
    setSymbolsText(list.join(","));
  };

  const toggleSort = (key) => setSort((s) => ({ key, dir: s.key === key && s.dir === "desc" ? "asc" : "desc" }));
  const arrow = (key) => (sort.key === key ? (sort.dir === "desc" ? " ↓" : " ↑") : "");

  return <Row className="g-3">
    <Col md={12}><Card body>
      <Form.Group className="mb-2"><Form.Label>WS URL</Form.Label><Form.Control value={app.wsUrl} onChange={(e) => app.setWsUrl(e.target.value)} /></Form.Group>
      <div className="d-flex gap-2 align-items-center flex-wrap"><Button onClick={app.connect}>Подключиться</Button><Button variant="outline-secondary" onClick={app.disconnect}>Отключиться</Button><span>Статус: <b>{app.status}</b> / ClientId: {app.clientId || "-"}</span></div>
    </Card></Col>
    <Col md={12}><Card body><Form.Label>Символы ({symbolCount}/100)</Form.Label>
      <div className="d-flex gap-2 flex-wrap"><Form.Control value={symbolsText} onChange={(e) => { setSymbolsText(e.target.value); }} /><Button onClick={() => onApplySymbols().catch(() => {})}>Применить</Button><Button variant="outline-primary" onClick={() => app.sendCommand("getSymbolsFromRating", { limit: 100, minCapUsd: 10_000_000 }).then((res) => setSymbolsText((res?.symbols || []).join(","))).catch(() => {})}>Из рейтинга</Button><Button onClick={app.startFeed}>Старт фид</Button><Button variant="outline-danger" onClick={app.stopFeed}>Стоп фид</Button></div>
      <div className="mt-2 d-flex gap-3 flex-wrap">{TOPICS.map((t) => <Form.Check key={t} type="checkbox" label={t} checked={!!subs[t]} onChange={(e) => onToggleSub(t, e.target.checked)} />)}</div>
    </Card></Col>
    <Col lg={6}><Card body><h6>Цены</h6><div className="small text-muted mb-1">Binance WS: <b>{bnState}</b>{bnHealth?.lastMsgAgeMs != null ? ` • age=${bnHealth.lastMsgAgeMs}ms` : ""}{bnHealth?.lastError ? ` • ${bnHealth.lastError}` : ""}</div><div style={{ maxHeight: TOP_HEIGHT, overflowY: "auto" }}><Table size="sm"><thead><tr><th>Symbol</th><th>Bybit</th><th>Binance</th></tr></thead><tbody>{rows.map((r) => <tr key={r.symbol}><td>{r.symbol}</td><td style={{ fontVariantNumeric: "tabular-nums" }}>{r.BT ? `${Number(r.BT.mid || 0).toFixed(6)} (BT)` : "-"}</td><td style={{ fontVariantNumeric: "tabular-nums" }}>{r.BNB ? `${Number(r.BNB.mid || 0).toFixed(6)} (BNB)` : <span title="нет данных Binance">нет данных BNB</span>}</td></tr>)}</tbody></Table></div></Card></Col>
    <Col lg={6}><Card body><h6>Лид-лаг (TOP-100)</h6><div style={{ maxHeight: TOP_HEIGHT, overflowY: "auto" }}><Table size="sm"><thead><tr><th role="button" onClick={() => toggleSort("leader")}>Лидер{arrow("leader")}</th><th role="button" onClick={() => toggleSort("follower")}>Фолловер{arrow("follower")}</th><th role="button" onClick={() => toggleSort("corr")}>Корреляция{arrow("corr")}</th><th role="button" onClick={() => toggleSort("lag")}>Lag (Δt){arrow("lag")}</th><th role="button" onClick={() => toggleSort("confirm")}>Подтверждение{arrow("confirm")}</th></tr></thead><tbody>{top.map((r, i) => <tr key={i}><td>{r.leaderDisplay || r.leader}</td><td>{r.followerDisplay || r.follower}</td><td style={{ fontVariantNumeric: "tabular-nums" }}>{Number(r.corr || 0).toFixed(3)}</td><td className="text-nowrap" style={{ fontVariantNumeric: "tabular-nums" }}>{Number(r.lagMs || 0)} ms</td><td><b>{r.confirmLabel || "NO_DATA"}</b></td></tr>)}</tbody></Table></div></Card></Col>
  </Row>;
}
