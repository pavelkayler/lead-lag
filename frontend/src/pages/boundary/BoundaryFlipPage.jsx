import { useEffect, useState } from "react";
import { Badge, Button, Card, Col, Form, Row, Table } from "react-bootstrap";
import { useApp } from "../../app/providers/AppProviders";

const DEFAULT_CFG = { symbol: "BTCUSDT", timeframe: "15m", firstSide: "SHORT", tpRoiPct: 0.8, slRoiPct: 0.6, spreadUsd: 12, notionalPerOrder: 30, mode: "paper", enableEarlyExit: true, minEarlyProfitPct: 0.3, minReverseBodyPct: 0.5, minBodyToRangeRatio: 0.6 };

export function BoundaryFlipPage() {
  const app = useApp();
  const [cfg, setCfg] = useState(DEFAULT_CFG);
  const status = app.boundaryFlip?.status || {};
  const logs = app.boundaryFlip?.logs || [];
  useEffect(() => { app.getBoundaryFlipBotStatus().catch(() => {}); }, []);
  return <Row className="g-3"><Col md={5}><Card body><h6>Boundary Flip Bot</h6>
    <Form.Group className="mb-2"><Form.Label>Symbol</Form.Label><Form.Select value={cfg.symbol} onChange={(e) => setCfg((d) => ({ ...d, symbol: e.target.value }))}>{(app.symbols || []).map((s) => <option key={s} value={s}>{s}</option>)}</Form.Select></Form.Group>
    <Form.Group className="mb-2"><Form.Label>Таймфрейм</Form.Label><Form.Select value={cfg.timeframe} onChange={(e) => setCfg((d) => ({ ...d, timeframe: e.target.value }))}><option value="5m">5m</option><option value="15m">15m</option><option value="1h">1h</option></Form.Select></Form.Group>
    <Form.Group className="mb-2"><Form.Label>Сторона первого цикла</Form.Label><Form.Select value={cfg.firstSide} onChange={(e) => setCfg((d) => ({ ...d, firstSide: e.target.value }))}><option value="LONG">LONG</option><option value="SHORT">SHORT</option></Form.Select></Form.Group>
    <div className="small mb-2">Точка входа (авто): {cfg.firstSide === "SHORT" ? "верхняя" : "нижняя"} граница</div>
    <Row className="g-2 mb-2"><Col><Form.Control type="number" placeholder="TP %" value={cfg.tpRoiPct} onChange={(e) => setCfg((d) => ({ ...d, tpRoiPct: Number(e.target.value) }))} /></Col><Col><Form.Control type="number" placeholder="SL %" value={cfg.slRoiPct} onChange={(e) => setCfg((d) => ({ ...d, slRoiPct: Number(e.target.value) }))} /></Col></Row>
    <Row className="g-2 mb-2"><Col><Form.Control type="number" placeholder="Spread $" value={cfg.spreadUsd} onChange={(e) => setCfg((d) => ({ ...d, spreadUsd: Number(e.target.value) }))} /></Col><Col><Form.Control type="number" placeholder="Notional" value={cfg.notionalPerOrder} onChange={(e) => setCfg((d) => ({ ...d, notionalPerOrder: Number(e.target.value) }))} /></Col></Row>
    <Form.Group className="mb-2"><Form.Label>Режим</Form.Label><Form.Select value={cfg.mode} onChange={(e) => setCfg((d) => ({ ...d, mode: e.target.value }))}><option value="paper">paper</option><option value="demo">demo</option><option value="real">real</option></Form.Select></Form.Group>
    <Form.Check type="checkbox" label="Досрочное закрытие" checked={cfg.enableEarlyExit} onChange={(e) => setCfg((d) => ({ ...d, enableEarlyExit: e.target.checked }))} className="mb-2" />
    <Row className="g-2 mb-2"><Col><Form.Control type="number" placeholder="min profit %" value={cfg.minEarlyProfitPct} onChange={(e) => setCfg((d) => ({ ...d, minEarlyProfitPct: Number(e.target.value) }))} /></Col><Col><Form.Control type="number" placeholder="reverse body %" value={cfg.minReverseBodyPct} onChange={(e) => setCfg((d) => ({ ...d, minReverseBodyPct: Number(e.target.value) }))} /></Col><Col><Form.Control type="number" placeholder="body/range" value={cfg.minBodyToRangeRatio} onChange={(e) => setCfg((d) => ({ ...d, minBodyToRangeRatio: Number(e.target.value) }))} /></Col></Row>
    <div className="d-flex gap-2"><Button onClick={() => app.startBoundaryFlipBot(cfg).catch(() => {})}>Запустить</Button><Button variant="outline-danger" onClick={() => app.stopBoundaryFlipBot().catch(() => {})}>Остановить</Button></div>
  </Card></Col>
  <Col md={7}><Card body><div className="d-flex justify-content-between"><h6>Статус</h6><Badge bg={status.state === "RUNNING" ? "success" : "secondary"}>{status.state || "STOPPED"}</Badge></div>
    <div className="small">cycle: {status.cycleId || 0} • side: {status.currentSide || "-"} • reason: {status.lastCycleReason || "-"}</div>
    <div className="small mb-2">upper={status.upper} lower={status.lower} boundary={status.boundaryPrice}</div>
    <Table size="sm"><thead><tr><th>Entry</th><th>TP</th><th>SL</th><th>Qty</th></tr></thead><tbody>{(status.plannedEntries || []).map((e) => <tr key={e.id}><td>{e.entryPrice}</td><td>{e.tpPrice}</td><td>{e.slPrice}</td><td>{e.qty}</td></tr>)}</tbody></Table>
    <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid #ddd", padding: 8 }}>{logs.slice().reverse().map((l, i) => <div key={i} className="small">[{l.level || "info"}] {l.msg}</div>)}</div>
  </Card></Col></Row>;
}
