import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Col, Form, Row, Table } from "react-bootstrap";
import { useApp } from "../../app/providers/AppProviders";

const DEFAULT_PRESETS = [
  { id: "profit-first", name: "profit-first", qtyUSDT: 25, minCorr: 0.15, stdBars: 120, impulseZ: 2.5, tpSigma: 1.5, slSigma: 1.0, maxHoldBars: 20, cooldownBars: 20 },
  { id: "balanced", name: "balanced", qtyUSDT: 20, minCorr: 0.2, stdBars: 160, impulseZ: 2.2, tpSigma: 1.3, slSigma: 1.1, maxHoldBars: 30, cooldownBars: 18 },
  { id: "safe", name: "safe", qtyUSDT: 18, minCorr: 0.25, stdBars: 200, impulseZ: 1.9, tpSigma: 1.1, slSigma: 0.9, maxHoldBars: 40, cooldownBars: 24 },
];

const SUMMARY_LABELS = {
  startingBalanceUSDT: "Начальный баланс",
  equityUSDT: "Эквити",
  cashUSDT: "Кэш",
  pnlUSDT: "PnL",
  netPnlUSDT: "Чистый PnL",
  unrealizedPnlUSDT: "Нереализованный PnL",
  realizedPnlUSDT: "Реализованный PnL",
  trades: "Сделки",
  wins: "Победы",
  losses: "Поражения",
  winRate: "Винрейт",
  feesUSDT: "Комиссии",
  maxDrawdownPct: "Макс. просадка",
  maxDrawdownUSDT: "Макс. просадка",
  durationSec: "Длительность",
  slippageUSDT: "Проскальзывание",
  endedAt: "Время окончания",
};

const COUNT_KEYS = new Set(["trades", "wins", "losses"]);
const MONEY_KEYS = new Set(["startingBalanceUSDT", "equityUSDT", "cashUSDT", "pnlUSDT", "netPnlUSDT", "unrealizedPnlUSDT", "realizedPnlUSDT", "feesUSDT", "maxDrawdownUSDT", "slippageUSDT"]);

function formatSummaryValue(key, value) {
  if (value == null || value === "") return "-";
  if (key === "endedAt") {
    const ts = Number(value);
    if (!Number.isFinite(ts) || ts <= 0) return "-";
    return new Date(ts).toLocaleString("ru-RU");
  }
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  if (COUNT_KEYS.has(key)) return String(Math.round(num));
  if (MONEY_KEYS.has(key)) return `${num.toFixed(2)} USDT`;
  if (key === "durationSec") return `${num.toFixed(2)} сек`;
  if (key === "winRate" || key.endsWith("Pct")) return `${num.toFixed(2)}%`;
  if (key.toLowerCase().includes("bps")) return `${num.toFixed(2)} bps`;
  if (key.toLowerCase().includes("ratio") || key.toLowerCase().includes("sigma")) return `${num.toFixed(2)}×`;
  return num.toFixed(2);
}

export function PaperTestPage() {
  const app = useApp();
  const [durationHours, setDurationHours] = useState(1);
  const [presets, setPresets] = useState(DEFAULT_PRESETS);
  const [selectedPresetIds, setSelectedPresetIds] = useState(DEFAULT_PRESETS.map((p) => p.id));
  const [activePresetId, setActivePresetId] = useState(DEFAULT_PRESETS[0].id);
  const [localStatus, setLocalStatus] = useState("");

  const activePreset = useMemo(() => presets.find((p) => p.id === activePresetId) || presets[0], [presets, activePresetId]);

  useEffect(() => {
    if (app.paperTest?.runId && app.paperTest?.summary) {
      const h = JSON.parse(localStorage.getItem("paperHistory") || "[]");
      if (!h.find((x) => x.runId === app.paperTest.runId) && !app.paperTest.running) {
        h.unshift({ runId: app.paperTest.runId, netPnlUSDT: app.paperTest.summary.netPnlUSDT, presets });
        localStorage.setItem("paperHistory", JSON.stringify(h.slice(0, 50)));
      }
    }
  }, [app.paperTest, presets]);

  const markDirty = () => setLocalStatus("выставлены новые настройки, нужны тесты");

  const updateActivePreset = (key, val) => {
    setPresets((prev) => prev.map((p) => (p.id === activePreset.id ? { ...p, [key]: val } : p)));
    markDirty();
  };

  const togglePreset = (id, checked) => {
    setSelectedPresetIds((prev) => {
      if (checked) return [...new Set([...prev, id])];
      const next = prev.filter((x) => x !== id);
      return next.length ? next : [id];
    });
  };

  const start = async () => {
    const selectedPresets = presets.filter((p) => selectedPresetIds.includes(p.id));
    await app.startPaperTest({ durationHours, rotateEveryMinutes: 5, presets: selectedPresets.map(({ id: _id, ...rest }) => rest) });
    setLocalStatus("");
  };

  const summaryRows = useMemo(() => {
    const summary = app.paperTest?.summary || {};
    const baseRows = Object.entries(summary)
      .filter(([k, v]) => typeof v !== "object" && !["runId", "startedAt"].includes(k))
      .map(([k, v]) => [k, v]);
    if (app.paperTest?.endsAt) baseRows.push(["endedAt", app.paperTest.endsAt]);
    return baseRows;
  }, [app.paperTest]);

  const learning = app.paperTest?.learning || {};

  return <Row className="g-3">
    <Col md={12}><Card body>
      <Form.Label>Длительность (часы)</Form.Label><Form.Range min={1} max={24} value={durationHours} onChange={(e) => setDurationHours(Number(e.target.value))} /><div>{durationHours}</div>
      <Form.Group className="mt-2">
        <Form.Label>Пресеты для запуска</Form.Label>
        <div className="d-flex flex-column gap-1">
          {presets.map((p) => (
            <div key={p.id} className="d-flex align-items-center gap-2">
              <Form.Check type="checkbox" checked={selectedPresetIds.includes(p.id)} onChange={(e) => togglePreset(p.id, e.target.checked)} />
              <Button variant={activePresetId === p.id ? "primary" : "link"} className="p-0 text-start" onClick={() => setActivePresetId(p.id)}>{p.name}</Button>
            </div>
          ))}
        </div>
      </Form.Group>
      <Form.Select multiple className="mt-2" value={selectedPresetIds} onChange={(e) => setSelectedPresetIds(Array.from(e.target.selectedOptions).map((o) => o.value))}>
        {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </Form.Select>
      <div className="mt-2 small text-muted">Редактируется пресет: <b>{activePreset?.name}</b></div>
      {Object.keys(DEFAULT_PRESETS[0]).filter((k) => !["name", "id"].includes(k)).map((k) => <div key={k}><Form.Label>{k}: {activePreset?.[k]}</Form.Label><Form.Range min={k.includes("Corr") ? 0.05 : 0.1} max={k.includes("Corr") ? 1 : 300} step={k.includes("Corr") ? 0.01 : 0.1} value={activePreset?.[k]} onChange={(e) => updateActivePreset(k, Number(e.target.value))} /></div>)}
      {(localStatus || learning.statusText) && <Alert className="py-1 mt-2 mb-2" variant="warning">{localStatus || learning.statusText}</Alert>}
      <div className="d-flex gap-2"><Button onClick={() => start().catch(() => {})}>Запустить тест</Button><Button variant="outline-danger" onClick={() => app.stopPaperTest().catch(() => {})}>Остановить</Button><Button variant="outline-secondary" onClick={() => localStorage.setItem("llPreset", JSON.stringify(activePreset))}>Скопировать в Демо/Реал</Button></div>
    </Card></Col>
    <Col md={12}><Card body><h6>Сводка</h6><Table size="sm" className="mb-0"><tbody>{summaryRows.map(([k,v]) => <tr key={k}><td className="py-1">{SUMMARY_LABELS[k] || k}</td><td className="py-1">{formatSummaryValue(k, v)}</td></tr>)}</tbody></Table></Card></Col>
    <Col md={12}><Card body><h6>Пресеты по времени</h6><Table size="sm"><thead><tr><th>Сегмент</th><th>Пресет</th><th>Сделки</th><th>Чистый PnL (USDT)</th></tr></thead><tbody>{(app.paperTest?.presetsByHour || []).map((r,i) => <tr key={i}><td>{r.segment || r.hour}</td><td>{r.preset}</td><td>{r.trades}</td><td>{Number(r.netPnlUSDT||0).toFixed(2)}</td></tr>)}</tbody></Table></Card></Col>
    <Col md={12}><Card body><h6>Топ пар</h6><Table size="sm"><thead><tr><th>Пара</th><th>Сделки</th><th>Чистый PnL (USDT)</th></tr></thead><tbody>{(app.paperTest?.topPairs || []).map((r,i) => <tr key={i}><td>{r.pair || r.symbol}</td><td>{r.tradesCount}</td><td>{Number(r.netPnlUSDT||0).toFixed(2)}</td></tr>)}</tbody></Table></Card></Col>
    <Col md={12}><Card body>
      <h6>Обучение / Рекомендации</h6>
      <div className="small mb-2">{localStatus || learning.statusText || "нужно тестировать текущие настройки"}</div>
      {learning.bestPresetName && <div className="small mb-2">Лучший пресет: <b>{learning.bestPresetName}</b></div>}
      <div style={{ height: 160, overflowY: "auto", border: "1px solid rgba(0,0,0,0.1)", borderRadius: 8, padding: 8, background: "#fff" }}>
        {(learning.log || []).length ? (learning.log || []).map((line, idx) => <div className="small" key={idx}>{line}</div>) : <div className="small text-muted">Лог пока пуст.</div>}
      </div>
    </Card></Col>
  </Row>;
}
