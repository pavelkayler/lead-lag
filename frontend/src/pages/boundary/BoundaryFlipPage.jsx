import { useEffect, useState } from "react";
import { Badge, Button, Card, Col, Form, Row, Table } from "react-bootstrap";
import { useApp } from "../../app/providers/AppProviders";

const DEFAULT_CFG = {
  symbol: "BTCUSDT",
  timeframe: "15m",
  firstSide: "SHORT",
  tpRoiPct: 0.8,
  slRoiPct: 0.6,
  spreadUsd: 12,
  notionalPerOrder: 30,
  mode: "paper",
  enableNearTpEarlyExit: true,
  nearTpWindowPct: 20,
  minTakeRoiPct: -1.2,
  usePullbackFromPeak: true,
  pullbackPctFromPeak: 0.5,
  reverseCandleRequired: true,
  minReverseBodyPct: 0.5,
  minBodyToRangeRatio: 0.6,
};

const help = {
  roi: "ROI (возврат на вложение) в этом боте — это % изменения цены от средней цены входа (avgEntry), без учёта плеча. TP — тейк-профит, SL — стоп-лосс.",
  spread: "Spread — разнос цен между лимитными входами текущего цикла. Чем выше значение, тем шире сетка входов и реже добор позиции.",
  notional: "Notional — сумма на один ордер в USDT. Итоговая позиция может состоять из нескольких ордеров, TP/SL считаются по средней цене позиции.",
  timeframe: "TF (таймфрейм) — период свечи, на котором проверяется разворотная свеча: 5m/15m/1h. Более высокий TF даёт меньше сигналов, но обычно они стабильнее.",
};

export function BoundaryFlipPage() {
  const app = useApp();
  const [cfg, setCfg] = useState(DEFAULT_CFG);
  const status = app.boundaryFlip?.status || {};
  const logs = app.boundaryFlip?.logs || [];

  useEffect(() => { app.getBoundaryFlipBotStatus().catch(() => {}); }, []);

  useEffect(() => {
    setCfg((prev) => {
      if (prev.minTakeRoiPct !== (prev.tpRoiPct - 2)) return prev;
      return { ...prev, minTakeRoiPct: Number((prev.tpRoiPct - 2).toFixed(4)) };
    });
  }, [cfg.tpRoiPct]);

  const setNum = (key) => (e) => setCfg((d) => ({ ...d, [key]: Number(e.target.value) }));

  return <Row className="g-3"><Col md={6}><Card body><h6>Boundary Flip Bot</h6>
    <Form.Group className="mb-3"><Form.Label>Торговая пара</Form.Label><Form.Select value={cfg.symbol} onChange={(e) => setCfg((d) => ({ ...d, symbol: e.target.value }))}>{(app.symbols || []).map((s) => <option key={s} value={s}>{s}</option>)}</Form.Select></Form.Group>

    <Form.Group className="mb-3"><Form.Label>Таймфрейм сигнала</Form.Label><Form.Select value={cfg.timeframe} onChange={(e) => setCfg((d) => ({ ...d, timeframe: e.target.value }))}><option value="5m">5m</option><option value="15m">15m</option><option value="1h">1h</option></Form.Select><Form.Text muted>{help.timeframe}</Form.Text></Form.Group>

    <Form.Group className="mb-3"><Form.Label>Сторона первого цикла</Form.Label><Form.Select value={cfg.firstSide} onChange={(e) => setCfg((d) => ({ ...d, firstSide: e.target.value }))}><option value="LONG">LONG</option><option value="SHORT">SHORT</option></Form.Select><Form.Text muted>Первый вход ставится на граничной цене: для SHORT — верхняя граница диапазона, для LONG — нижняя. После закрытия цикл автоматически переворачивается.</Form.Text></Form.Group>

    <Row className="g-2 mb-1"><Col><Form.Label>TP, %</Form.Label><Form.Control type="number" value={cfg.tpRoiPct} onChange={setNum("tpRoiPct")} /></Col><Col><Form.Label>SL, %</Form.Label><Form.Control type="number" value={cfg.slRoiPct} onChange={setNum("slRoiPct")} /></Col></Row>
    <Form.Text className="d-block mb-3" muted>{help.roi}</Form.Text>

    <Row className="g-2 mb-1"><Col><Form.Label>Spread, $</Form.Label><Form.Control type="number" value={cfg.spreadUsd} onChange={setNum("spreadUsd")} /></Col><Col><Form.Label>Notional, USDT</Form.Label><Form.Control type="number" value={cfg.notionalPerOrder} onChange={setNum("notionalPerOrder")} /></Col></Row>
    <Form.Text className="d-block" muted>{help.spread}</Form.Text>
    <Form.Text className="d-block mb-3" muted>{help.notional}</Form.Text>

    <Form.Group className="mb-3"><Form.Label>Режим исполнения</Form.Label><Form.Select value={cfg.mode} onChange={(e) => setCfg((d) => ({ ...d, mode: e.target.value }))}><option value="paper">paper</option><option value="demo">demo</option><option value="real">real</option></Form.Select></Form.Group>

    <h6 className="mt-3">Досрочное закрытие возле тейка</h6>
    <Form.Check type="checkbox" label="Включить досрочное закрытие только в зоне рядом с TP" checked={cfg.enableNearTpEarlyExit} onChange={(e) => setCfg((d) => ({ ...d, enableNearTpEarlyExit: e.target.checked }))} className="mb-2" />

    <Row className="g-2 mb-1"><Col><Form.Label>Окно near-TP, %</Form.Label><Form.Control type="number" value={cfg.nearTpWindowPct} onChange={setNum("nearTpWindowPct")} /></Col><Col><Form.Label>Мин. ROI для выхода, %</Form.Label><Form.Control type="number" value={cfg.minTakeRoiPct} onChange={setNum("minTakeRoiPct")} /></Col></Row>
    <Form.Text className="d-block" muted>Near-TP окно — часть движения до TP, где разрешён ранний выход. Пример: TP=15%, окно=20% → зона от +12% до +15%.</Form.Text>
    <Form.Text className="d-block mb-3" muted>Мин. ROI ограничивает слишком ранний выход даже внутри near-TP зоны. Типично: TP-1…TP-3.</Form.Text>

    <Form.Check type="checkbox" label="Требовать откат от локального пика (Peak → Pullback)" checked={cfg.usePullbackFromPeak} onChange={(e) => setCfg((d) => ({ ...d, usePullbackFromPeak: e.target.checked }))} className="mb-2" />
    <Form.Group className="mb-3"><Form.Label>Откат от пика, %</Form.Label><Form.Control type="number" value={cfg.pullbackPctFromPeak} onChange={setNum("pullbackPctFromPeak")} /><Form.Text muted>Peak — локальный максимум/минимум внутри near-TP зоны. Pullback — откат от этого пика. Пример: пик +14.2%, откат 0.5% → сигнал при +13.7% и ниже (для LONG).</Form.Text></Form.Group>

    <Form.Check type="checkbox" label="Требовать уверенную разворотную свечу против позиции" checked={cfg.reverseCandleRequired} onChange={(e) => setCfg((d) => ({ ...d, reverseCandleRequired: e.target.checked }))} className="mb-2" />
    <Row className="g-2 mb-3"><Col><Form.Label>Мин. размер тела свечи, %</Form.Label><Form.Control type="number" value={cfg.minReverseBodyPct} onChange={setNum("minReverseBodyPct")} /></Col><Col><Form.Label>Тело/диапазон свечи</Form.Label><Form.Control type="number" value={cfg.minBodyToRangeRatio} onChange={setNum("minBodyToRangeRatio")} /></Col></Row>
    <Form.Text className="d-block mb-3" muted>Тело свечи = |close-open|, диапазон = high-low. Фильтр тела/диапазона отсеивает свечи с длинными хвостами и слабым закрытием.</Form.Text>

    <div className="d-flex gap-2"><Button onClick={() => app.startBoundaryFlipBot(cfg).catch(() => {})}>Запустить</Button><Button variant="outline-danger" onClick={() => app.stopBoundaryFlipBot().catch(() => {})}>Остановить</Button></div>
  </Card></Col>
  <Col md={6}><Card body><div className="d-flex justify-content-between"><h6>Статус</h6><Badge bg={status.state === "RUNNING" ? "success" : "secondary"}>{status.state || "STOPPED"}</Badge></div>
    <div className="small">cycle: {status.cycleId || 0} • side: {status.currentSide || "-"} • reason: {status.lastCycleReason || "-"}</div>
    <div className="small mb-2">upper={status.upper} lower={status.lower} boundary={status.boundaryPrice}</div>
    <Table size="sm"><thead><tr><th>Entry</th><th>TP</th><th>SL</th><th>Qty</th></tr></thead><tbody>{(status.plannedEntries || []).map((e) => <tr key={e.id}><td>{e.entryPrice}</td><td>{e.tpPrice}</td><td>{e.slPrice}</td><td>{e.qty}</td></tr>)}</tbody></Table>
    <div style={{ maxHeight: 260, overflowY: "auto", border: "1px solid #ddd", padding: 8 }}>{logs.slice().reverse().map((l, i) => <div key={i} className="small">[{l.level || "info"}] {l.msg}</div>)}</div>
  </Card></Col></Row>;
}
