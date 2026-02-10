import { useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Card, Col, Form, ProgressBar, Row, Table } from "react-bootstrap";
import { useApp } from "../../app/providers/AppProviders";

const DEFAULT_PRESETS = [
  { id: "profit-first", name: "profit-first", qtyUSDT: 25, minCorr: 0.15, stdBars: 120, impulseZ: 2.5, tpSigma: 1.7, slSigma: 1.0, maxHoldBars: 20, cooldownBars: 20 },
  { id: "balanced", name: "balanced", qtyUSDT: 20, minCorr: 0.2, stdBars: 160, impulseZ: 2.2, tpSigma: 1.4, slSigma: 1.0, maxHoldBars: 28, cooldownBars: 16 },
  { id: "safe", name: "safe", qtyUSDT: 14, minCorr: 0.26, stdBars: 220, impulseZ: 2.4, tpSigma: 1.2, slSigma: 0.8, maxHoldBars: 32, cooldownBars: 28 },
  { id: "fast-scalp", name: "fast-scalp", qtyUSDT: 16, minCorr: 0.13, stdBars: 90, impulseZ: 1.9, tpSigma: 1.0, slSigma: 0.9, maxHoldBars: 12, cooldownBars: 8 },
  { id: "slow-swing", name: "slow-swing", qtyUSDT: 18, minCorr: 0.24, stdBars: 260, impulseZ: 2.8, tpSigma: 1.8, slSigma: 1.2, maxHoldBars: 44, cooldownBars: 26 },
  { id: "strict-filter", name: "strict-filter", qtyUSDT: 12, minCorr: 0.32, stdBars: 200, impulseZ: 2.9, tpSigma: 1.3, slSigma: 0.9, maxHoldBars: 26, cooldownBars: 25 },
  { id: "loose-filter", name: "loose-filter", qtyUSDT: 22, minCorr: 0.11, stdBars: 110, impulseZ: 1.7, tpSigma: 1.5, slSigma: 1.1, maxHoldBars: 24, cooldownBars: 10 },
  { id: "low-risk", name: "low-risk", qtyUSDT: 10, minCorr: 0.28, stdBars: 180, impulseZ: 2.3, tpSigma: 1.1, slSigma: 0.7, maxHoldBars: 30, cooldownBars: 24 },
  { id: "high-risk", name: "high-risk", qtyUSDT: 30, minCorr: 0.12, stdBars: 95, impulseZ: 1.6, tpSigma: 2.2, slSigma: 1.5, maxHoldBars: 18, cooldownBars: 7 },
  { id: "mean-revert", name: "mean-revert", qtyUSDT: 17, minCorr: 0.18, stdBars: 150, impulseZ: 2.0, tpSigma: 1.25, slSigma: 0.95, maxHoldBars: 22, cooldownBars: 14 },
];

const SUMMARY_LABELS = {
  endsAt: "Время окончания",
  durationSec: "Длительность",
  startingBalanceUSDT: "Начальный баланс",
  equityUSDT: "Эквити",
  trades: "Сделки",
  wins: "Победы",
  losses: "Поражения",
  winRate: "Винрейт",
  grossPnlUSDT: "Валовый PnL",
  feesUSDT: "Комиссии",
  slippageUSDT: "Проскальзывание",
  netPnlUSDT: "Чистый PnL",
  netPnlBps: "PnL (bps)",
  profitFactor: "Профит-фактор",
  maxDrawdownUSDT: "Макс. просадка",
  avgHoldSec: "Среднее удержание",
  avgR: "Средний R",
  notes: "Заметки",
};

const PARAM_CONFIG = {
  qtyUSDT: { min: 5, max: 100, step: 1, label: "qtyUSDT" },
  minCorr: { min: 0.05, max: 1, step: 0.01, label: "minCorr" },
  stdBars: { min: 50, max: 400, step: 5, label: "stdBars" },
  impulseZ: { min: 0.5, max: 5, step: 0.1, label: "impulseZ" },
  tpSigma: { min: 0.5, max: 4, step: 0.05, label: "tpSigma" },
  slSigma: { min: 0.3, max: 4, step: 0.05, label: "slSigma" },
  maxHoldBars: { min: 5, max: 120, step: 1, label: "maxHoldBars" },
  cooldownBars: { min: 0, max: 120, step: 1, label: "cooldownBars" },
};

const COUNT_KEYS = new Set(["trades", "wins", "losses"]);
const MONEY_KEYS = new Set(["startingBalanceUSDT", "equityUSDT", "grossPnlUSDT", "feesUSDT", "slippageUSDT", "netPnlUSDT", "maxDrawdownUSDT"]);

function toPresetId(name) {
  return String(name || "preset").toLowerCase();
}

function alignStep(value, cfg) {
  const num = Number(value);
  if (!Number.isFinite(num)) return cfg.min;
  const clamped = Math.min(cfg.max, Math.max(cfg.min, num));
  const steps = Math.round((clamped - cfg.min) / cfg.step);
  const fixed = cfg.min + steps * cfg.step;
  const decimals = String(cfg.step).includes(".") ? String(cfg.step).split(".")[1].length : 0;
  return Number(fixed.toFixed(decimals));
}

function formatSummaryValue(key, value) {
  if (value == null || value === "") return "-";
  if (key === "endsAt") {
    const parsed = Number(value);
    const ts = Number.isFinite(parsed) ? parsed : Date.parse(String(value));
    if (!Number.isFinite(ts) || ts <= 0) return "-";
    return new Date(ts).toLocaleString("ru-RU");
  }
  if (key === "notes") return String(value);

  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  if (COUNT_KEYS.has(key)) return String(Math.round(num));
  if (MONEY_KEYS.has(key)) return `${num.toFixed(2)} USDT`;
  if (key === "durationSec" || key === "avgHoldSec") return `${num.toFixed(2)} сек`;
  if (key === "netPnlBps") return `${num.toFixed(2)} bps`;
  if (key === "profitFactor") return Number.isFinite(num) ? `${num.toFixed(2)}×` : "∞";
  if (key === "winRate") return `${(num * 100).toFixed(2)}%`;
  if (key === "avgR") return `${num.toFixed(2)}×`;
  return num.toFixed(2);
}

export function PaperTestPage() {
  const app = useApp();
  const [durationHours, setDurationHours] = useState(1);
  const [presets, setPresets] = useState(DEFAULT_PRESETS);
  const [selectedPresetIds, setSelectedPresetIds] = useState(DEFAULT_PRESETS.map((p) => p.id));
  const [activePresetId, setActivePresetId] = useState(DEFAULT_PRESETS[0].id);
  const [localStatus, setLocalStatus] = useState("");

  useEffect(() => {
    const external = app.paperTest?.presets;
    if (!Array.isArray(external) || !external.length) return;
    setPresets((prev) => {
      const normalized = external.map((p) => {
        const id = toPresetId(p.id || p.name);
        const old = prev.find((x) => x.id === id);
        return { ...old, ...p, id, name: p.name || id };
      });
      const merged = prev.map((p) => normalized.find((x) => x.id === p.id) || p);
      setSelectedPresetIds((oldSel) => oldSel.filter((id) => merged.some((p) => p.id === id)));
      return merged;
    });
  }, [app.paperTest?.presets]);

  const activePreset = useMemo(() => presets.find((p) => p.id === activePresetId) || presets[0], [presets, activePresetId]);

  useEffect(() => {
    if (!presets.some((p) => p.id === activePresetId) && presets[0]) setActivePresetId(presets[0].id);
  }, [presets, activePresetId]);

  const markDirty = () => setLocalStatus("выставлены новые настройки, нужны тесты");

  const updateActivePreset = (key, val) => {
    const cfg = PARAM_CONFIG[key];
    const nextVal = cfg ? alignStep(val, cfg) : Number(val);
    setPresets((prev) => prev.map((p) => (p.id === activePreset?.id ? { ...p, [key]: nextVal } : p)));
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
    await app.startPaperTest({ durationHours, rotateEveryMinutes: 5, presets: selectedPresets.map(({ id: _id, ...rest }) => rest), autoTune: true });
    setLocalStatus("");
  };

  const summaryRows = useMemo(() => {
    const summary = app.paperTest?.summary || {};
    const keys = Object.keys(SUMMARY_LABELS);
    return keys.filter((k) => summary[k] != null || (k === "endsAt" && app.paperTest?.endsAt)).map((k) => [k, k === "endsAt" ? (summary.endsAt ?? app.paperTest?.endsAt) : summary[k]]);
  }, [app.paperTest]);

  const learning = app.paperTest?.learning || {};
  const learningState = learning.state || app.paperTest?.state || "STOPPED";
  const isRunning = learningState !== "STOPPED";
  const waiting = learningState === "RUNNING_WAITING";
  const etaLabel = Number.isFinite(Number(learning.etaSec)) ? `~${Number(learning.etaSec).toFixed(1)} сек` : "неизвестно (мало данных)";

  return <Row className="g-3">
    <Col md={12}><Card body>
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
        <h6 className="mb-0">Paper Test</h6>
        <Badge bg={isRunning ? "success" : "secondary"}>{isRunning ? "Тест запущен" : "Тест остановлен"}</Badge>
      </div>
      <Form.Label className="mb-1">Длительность (часы)</Form.Label><Form.Range min={1} max={24} value={durationHours} onChange={(e) => setDurationHours(Number(e.target.value))} /><div className="small text-muted">{durationHours}</div>
      <Form.Group className="mt-2">
        <div className="d-flex align-items-center justify-content-between gap-2 mb-1">
          <Form.Label className="mb-0">Пресеты для запуска</Form.Label>
          <div className="d-flex align-items-center gap-2">
            <Form.Label className="mb-0 small">Редактируется пресет:</Form.Label>
            <Form.Select size="sm" style={{ width: 180 }} value={activePreset?.id || ""} onChange={(e) => setActivePresetId(e.target.value)}>
              {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Form.Select>
          </div>
        </div>
        <div className="d-flex flex-wrap gap-2">
          {presets.map((p) => (
            <Form.Check
              key={p.id}
              type="checkbox"
              id={`preset-${p.id}`}
              className="mb-0"
              label={p.name}
              checked={selectedPresetIds.includes(p.id)}
              onChange={(e) => togglePreset(p.id, e.target.checked)}
            />
          ))}
        </div>
      </Form.Group>
      <div className="mt-2">
        {Object.entries(PARAM_CONFIG).map(([k, cfg]) => <div key={k} className="d-flex align-items-center gap-2 mb-1">
          <Form.Label className="mb-0" style={{ width: 125 }}>{cfg.label}</Form.Label>
          <Form.Range className="mb-0" min={cfg.min} max={cfg.max} step={cfg.step} value={activePreset?.[k] ?? cfg.min} onChange={(e) => updateActivePreset(k, Number(e.target.value))} />
          <Form.Control size="sm" type="number" style={{ width: 110 }} min={cfg.min} max={cfg.max} step={cfg.step} value={activePreset?.[k] ?? cfg.min} onChange={(e) => updateActivePreset(k, Number(e.target.value))} />
        </div>)}
      </div>
      {(localStatus || learning.statusText) && <Alert className="py-1 mt-2 mb-2" variant="warning">{localStatus || learning.statusText}</Alert>}
      <div className="d-flex gap-2 flex-wrap"><Button onClick={() => start().catch(() => {})}>Запустить тест</Button><Button variant="outline-danger" onClick={() => app.stopPaperTest().catch(() => {})}>Остановить</Button><Button variant="outline-secondary" onClick={() => app.sendCommand("resetLearning", {}).catch(() => {})}>Сбросить историю</Button><Button variant="outline-secondary" onClick={() => localStorage.setItem("llPreset", JSON.stringify(activePreset))}>Скопировать в Демо/Реал</Button></div>
    </Card></Col>
    <Col md={12}><Card body><h6 className="mb-2">Сводка</h6><Table size="sm" className="mb-0"><tbody>{summaryRows.map(([k,v]) => <tr key={k}><td style={{ padding: "0.2rem 0.35rem" }}>{SUMMARY_LABELS[k]}</td><td style={{ padding: "0.2rem 0.35rem" }}>{formatSummaryValue(k, v)}</td></tr>)}</tbody></Table></Card></Col>
    <Col md={12}><Card body><h6>Пресеты по времени</h6><Table size="sm"><thead><tr><th>Сегмент</th><th>Пресет</th><th>Сделки</th><th>Чистый PnL (USDT)</th></tr></thead><tbody>{(app.paperTest?.presetsByHour || []).map((r,i) => <tr key={i}><td>{r.segment || r.hour}</td><td>{r.preset}</td><td>{r.trades}</td><td>{Number(r.netPnlUSDT||0).toFixed(2)}</td></tr>)}</tbody></Table></Card></Col>
    <Col md={12}><Card body><h6>Топ пар</h6><Table size="sm"><thead><tr><th>Пара</th><th>Сделки</th><th>Чистый PnL (USDT)</th></tr></thead><tbody>{(app.paperTest?.topPairs || []).map((r,i) => <tr key={i}><td>{r.pair || r.symbol}</td><td>{r.tradesCount}</td><td>{Number(r.netPnlUSDT||0).toFixed(2)}</td></tr>)}</tbody></Table></Card></Col>
    <Col md={12}><Card body>
      <h6 className="mb-2">Обучение / Рекомендации</h6>
      <div className="small mb-1">Тест: <b>{isRunning ? "запущен" : "остановлен"}</b> • Статус: <b>{learningState === "RUNNING_IN_TRADE" ? "в сделке" : (isRunning ? "ищет сделку" : "остановлен")}</b></div>
      <div className="small mb-1">ETA до следующей сделки: <b>{etaLabel}</b></div>
      <ProgressBar className="mb-2" striped={waiting} animated={waiting} variant={learningState === "RUNNING_IN_TRADE" ? "success" : "info"} now={learningState === "RUNNING_IN_TRADE" ? 100 : (isRunning ? 50 : 0)} />
      <div className="small mb-1">{localStatus || learning.statusText || "нужно тестировать текущие настройки"}</div>
      {learning.bestPresetName && <div className="small mb-2">Лучший пресет сейчас: <b>{learning.bestPresetName}</b></div>}
      <div style={{ height: 170, overflowY: "auto", border: "1px solid rgba(0,0,0,0.1)", borderRadius: 8, padding: 8, background: "#fff" }}>
        {(learning.log || []).length ? (learning.log || []).map((line, idx) => <div className="small" key={idx}>{line}</div>) : <div className="small text-muted">Лог пока пуст.</div>}
      </div>
    </Card></Col>
  </Row>;
}
