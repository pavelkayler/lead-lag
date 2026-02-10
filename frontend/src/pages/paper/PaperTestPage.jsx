import { useEffect, useState } from "react";
import { Button, Card, Col, Form, Row, Table } from "react-bootstrap";
import { useApp } from "../../app/providers/AppProviders";

const PRESET = { name: "profit-first", qtyUSDT: 25, minCorr: 0.15, stdBars: 120, impulseZ: 2.5, tpSigma: 1.5, slSigma: 1.0, maxHoldBars: 20, cooldownBars: 20 };

const SUMMARY_LABELS = {
  startingBalanceUSDT: "Начальный баланс (USDT)",
  equityUSDT: "Эквити (USDT)",
  cashUSDT: "Кэш (USDT)",
  pnlUSDT: "PnL (USDT)",
  netPnlUSDT: "Чистый PnL (USDT)",
  unrealizedPnlUSDT: "Нереализованный PnL (USDT)",
  realizedPnlUSDT: "Реализованный PnL (USDT)",
  trades: "Сделки",
  wins: "Победы",
  losses: "Поражения",
  winRate: "Винрейт",
  feesUSDT: "Комиссии (USDT)",
  maxDrawdownPct: "Макс. просадка (%)",
  maxDrawdownUSDT: "Макс. просадка (USDT)",
  durationSec: "Длительность (сек)",
};

export function PaperTestPage() {
  const app = useApp();
  const [durationHours, setDurationHours] = useState(1);
  const [multi, setMulti] = useState(false);
  const [preset, setPreset] = useState(PRESET);

  useEffect(() => {
    if (app.paperTest?.runId && app.paperTest?.summary) {
      const h = JSON.parse(localStorage.getItem("paperHistory") || "[]");
      if (!h.find((x) => x.runId === app.paperTest.runId) && !app.paperTest.running) {
        h.unshift({ runId: app.paperTest.runId, netPnlUSDT: app.paperTest.summary.netPnlUSDT, preset });
        localStorage.setItem("paperHistory", JSON.stringify(h.slice(0, 50)));
      }
    }
  }, [app.paperTest]);

  const start = () => app.startPaperTest({ durationHours, rotateEveryMinutes: 5, presets: multi ? [preset, { ...preset, name: "alt", impulseZ: preset.impulseZ * 0.9 }] : [preset] });

  return <Row className="g-3">
    <Col md={12}><Card body><Form.Check type="switch" label={multi ? "Массив пресетов" : "Один пресет"} checked={multi} onChange={(e) => setMulti(e.target.checked)} />
      <Form.Label>Длительность (часы)</Form.Label><Form.Range min={1} max={24} value={durationHours} onChange={(e) => setDurationHours(Number(e.target.value))} /><div>{durationHours}</div>
      {Object.keys(PRESET).filter((k) => k !== "name").map((k) => <div key={k}><Form.Label>{k}: {preset[k]}</Form.Label><Form.Range min={k.includes("Corr") ? 0.05 : 0.1} max={k.includes("Corr") ? 1 : 300} step={k.includes("Corr") ? 0.01 : 0.1} value={preset[k]} onChange={(e) => setPreset((p) => ({ ...p, [k]: Number(e.target.value) }))} /></div>)}
      <div className="d-flex gap-2"><Button onClick={start}>Запустить тест</Button><Button variant="outline-danger" onClick={app.stopPaperTest}>Остановить</Button><Button variant="outline-secondary" onClick={() => localStorage.setItem("llPreset", JSON.stringify(preset))}>Скопировать в Демо/Реал</Button></div>
    </Card></Col>
    <Col md={12}><Card body><h6>Сводка</h6><Table size="sm"><tbody>{Object.entries(app.paperTest?.summary || {}).filter(([k,v]) => typeof v !== "object" && !["runId","startedAt","endedAt"].includes(k)).map(([k,v]) => <tr key={k}><td>{SUMMARY_LABELS[k] || k}</td><td>{String(v)}</td></tr>)}</tbody></Table></Card></Col>
    <Col md={12}><Card body><h6>Пресеты по времени</h6><Table size="sm"><thead><tr><th>Час</th><th>Пресет</th><th>Сделки</th><th>Чистый PnL (USDT)</th></tr></thead><tbody>{(app.paperTest?.presetsByHour || []).map((r,i) => <tr key={i}><td>{r.hour}</td><td>{r.preset}</td><td>{r.trades}</td><td>{Number(r.netPnlUSDT||0).toFixed(4)}</td></tr>)}</tbody></Table></Card></Col>
    <Col md={12}><Card body><h6>Топ пар</h6><Table size="sm"><thead><tr><th>Пара</th><th>Сделки</th><th>Чистый PnL (USDT)</th></tr></thead><tbody>{(app.paperTest?.topPairs || []).map((r,i) => <tr key={i}><td>{r.pair || r.symbol}</td><td>{r.tradesCount}</td><td>{Number(r.netPnlUSDT||0).toFixed(4)}</td></tr>)}</tbody></Table></Card></Col>
  </Row>;
}
