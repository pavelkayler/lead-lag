import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Badge, Button, Card, Col, Form, ProgressBar, Row, Table, Tabs, Tab } from "react-bootstrap";
import { useApp } from "../../app/providers/AppProviders";

const DEFAULT_PRESETS = [
  { id: "profit-first", name: "profit-first", qtyUSDT: 25, minCorr: 0.15, stdBars: 120, impulseZ: 2.5, tpSigma: 1.7, slSigma: 1.0, maxHoldBars: 20, cooldownBars: 20 },
  { id: "balanced", name: "balanced", qtyUSDT: 20, minCorr: 0.2, stdBars: 160, impulseZ: 2.2, tpSigma: 1.4, slSigma: 1.0, maxHoldBars: 28, cooldownBars: 16 },
  { id: "safe", name: "safe", qtyUSDT: 14, minCorr: 0.26, stdBars: 220, impulseZ: 2.4, tpSigma: 1.2, slSigma: 0.8, maxHoldBars: 32, cooldownBars: 28 },
];

const SUMMARY_LABELS = {
  endsAt: "Время окончания", durationSec: "Длительность", startingBalanceUSDT: "Начальный баланс", equityUSDT: "Эквити", trades: "Сделки", wins: "Победы", losses: "Поражения", netPnlUSDT: "Чистый PnL",
  winRate: "Винрейт", grossPnlUSDT: "Валовый PnL", feesUSDT: "Комиссии", slippageUSDT: "Проскальзывание", netPnlBps: "PnL (bps)", profitFactor: "Профит-фактор", maxDrawdownUSDT: "Макс. просадка", avgHoldSec: "Среднее удержание", avgR: "Средний R", notes: "Заметки",
};
const SHORT_KEYS = ["endsAt", "durationSec", "startingBalanceUSDT", "equityUSDT", "trades", "wins", "losses", "netPnlUSDT"];

function toPresetId(name) { return String(name || "preset").toLowerCase(); }
function formatDuration(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const ss = s % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${ss.toString().padStart(2, "0")}`;
}
function formatSummaryValue(key, value) {
  const num = Number(value);
  if (key === "durationSec") return `${formatDuration(num)} (${num.toFixed(0)} сек)`;
  if (key === "endsAt") return Number.isFinite(num) && num > 0 ? new Date(num).toLocaleString("ru-RU") : "-";
  if (Number.isNaN(num)) return String(value ?? "-");
  if (["startingBalanceUSDT", "equityUSDT", "grossPnlUSDT", "feesUSDT", "slippageUSDT", "netPnlUSDT", "maxDrawdownUSDT"].includes(key)) return `${num.toFixed(2)} USDT`;
  if (key === "winRate") return `${(num * 100).toFixed(2)}%`;
  if (key === "netPnlBps") return `${num.toFixed(2)} bps`;
  return num.toFixed(2);
}

export function PaperTestPage() {
  const app = useApp();
  const [durationHours, setDurationHours] = useState(1);
  const [presets, setPresets] = useState(DEFAULT_PRESETS);
  const [selectedPresetIds, setSelectedPresetIds] = useState(DEFAULT_PRESETS.map((p) => p.id));
  const [activePresetId, setActivePresetId] = useState(DEFAULT_PRESETS[0].id);
  const [multiStrategy, setMultiStrategy] = useState(true);
  const [exploitBest, setExploitBest] = useState(true);
  const [isolatedPresetName, setIsolatedPresetName] = useState(DEFAULT_PRESETS[0].name);
  const [summaryTab, setSummaryTab] = useState("short");
  const [localStatus, setLocalStatus] = useState("");
  const [durationNowSec, setDurationNowSec] = useState(0);
  const logRef = useRef(null);

  useEffect(() => {
    const external = app.paperTest?.presets;
    if (!Array.isArray(external) || !external.length) return;
    setPresets(external.map((p) => ({ ...p, id: toPresetId(p.id || p.name) })));
  }, [app.paperTest?.presets]);

  useEffect(() => {
    const startedAt = Number(app.paperTest?.startedAt || 0);
    if (!app.paperTest?.running || !startedAt) return;
    const t = setInterval(() => setDurationNowSec(Math.max(0, (Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(t);
  }, [app.paperTest?.running, app.paperTest?.startedAt]);

  useEffect(() => {
    const el = logRef.current;
    if (!el) return;
    const nearBottom = (el.scrollHeight - el.scrollTop - el.clientHeight) < 24;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [app.paperTest?.learning?.log]);

  const learning = app.paperTest?.learning || {};
  const learningState = learning.state || app.paperTest?.state || "STOPPED";
  const isRunning = learningState !== "STOPPED";

  const activePreset = presets.find((p) => p.id === activePresetId) || presets[0];

  const summary = app.paperTest?.summary || {};
  const summaryRows = Object.entries(summary).filter(([k, v]) => SUMMARY_LABELS[k] && typeof v !== "object");
  const shortRows = summaryRows.filter(([k]) => SHORT_KEYS.includes(k)).map(([k, v]) => [k, k === "durationSec" && isRunning ? durationNowSec : v]);
  const fullRows = summaryRows.map(([k, v]) => [k, k === "durationSec" && isRunning ? durationNowSec : v]);

  const statusHashEq = learning.lastSettingsHash && learning.runningSettingsHash && learning.lastSettingsHash === learning.runningSettingsHash;

  const selectedPresets = presets.filter((p) => selectedPresetIds.includes(p.id));

  const start = async () => {
    const presetsPayload = multiStrategy ? selectedPresets : [presets.find((p) => p.name === isolatedPresetName) || activePreset].filter(Boolean);
    if (!presetsPayload.length) throw new Error("Выберите хотя бы один пресет");
    await app.startPaperTest({ durationHours, rotateEveryMinutes: 60, symbolsCount: 100, minMarketCapUsd: 10_000_000, presets: presetsPayload, multiStrategy, exploitBest, isolatedPresetName });
    setLocalStatus("Тест отправлен на запуск");
  };

  return <Row className="g-3">
    <Col md={12}><Card body>
      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2"><h6 className="mb-0">Paper Test</h6><Badge bg={isRunning ? "success" : "secondary"}>{isRunning ? "Тест запущен" : "Тест остановлен"}</Badge></div>
      <Form.Label className="mb-1">Длительность (часы)</Form.Label><Form.Range min={1} max={24} value={durationHours} onChange={(e) => setDurationHours(Number(e.target.value))} /><div className="small text-muted">{durationHours}</div>
      <div className="d-flex gap-4 flex-wrap mb-2">
        <Form.Check type="checkbox" label="Мульти-стратегия (параллельно)" checked={multiStrategy} onChange={(e) => setMultiStrategy(e.target.checked)} />
        <Form.Check type="checkbox" label="Эксплуатация лучшего" checked={exploitBest} onChange={(e) => setExploitBest(e.target.checked)} />
      </div>
      {!multiStrategy && <Form.Group className="mb-2"><Form.Label>Тестировать только пресет</Form.Label><Form.Select value={isolatedPresetName} onChange={(e) => setIsolatedPresetName(e.target.value)} style={{ maxWidth: 280 }}>{presets.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}</Form.Select></Form.Group>}
      <div className="d-flex gap-2 flex-wrap">{presets.map((p) => <Form.Check key={p.id} type="checkbox" label={p.name} checked={selectedPresetIds.includes(p.id)} onChange={(e) => setSelectedPresetIds((old) => e.target.checked ? [...new Set([...old, p.id])] : old.filter((id) => id !== p.id))} />)}</div>
      {(localStatus || learning.statusText) && <Alert className="py-1 mt-2 mb-2" variant="warning">{localStatus || learning.statusText}</Alert>}
      {statusHashEq && <Alert className="py-1 mt-2 mb-2" variant="success">тест с новыми настройками запущен</Alert>}
      <div className="d-flex gap-2 flex-wrap"><Button onClick={() => start().catch(() => {})}>Запустить тест</Button><Button variant="outline-danger" onClick={() => app.stopPaperTest().catch(() => {})}>Остановить</Button><Button variant="outline-secondary" onClick={() => app.sendCommand("resetLearning", {}).catch(() => {})}>Сбросить историю</Button></div>
    </Card></Col>

    <Col md={12}><Card body style={{ maxWidth: 760 }}><h6 className="mb-2">Сводка</h6>
      <Tabs activeKey={summaryTab} onSelect={(k) => setSummaryTab(k || "short")} className="mb-2"><Tab eventKey="short" title="Кратко" /><Tab eventKey="full" title="Детально" /></Tabs>
      <Table size="sm" className="mb-0"><tbody>{(summaryTab === "short" ? shortRows : fullRows).map(([k, v]) => <tr key={k}><td style={{ width: 280, padding: "0.25rem 0.5rem" }}>{SUMMARY_LABELS[k]}</td><td style={{ width: 220, textAlign: "right", fontVariantNumeric: "tabular-nums", padding: "0.25rem 0.5rem" }}>{formatSummaryValue(k, v)}</td></tr>)}</tbody></Table>
    </Card></Col>

    <Col md={12}><Card body><h6>Пресеты по времени</h6><Table size="sm"><thead><tr><th>Сегмент</th><th>Пресет</th><th>Сделки</th><th>Чистый PnL (USDT)</th></tr></thead><tbody>{(app.paperTest?.presetsByHour || []).map((r, i) => <tr key={i}><td>{r.segment || r.hour}</td><td>{r.preset}</td><td>{r.trades}</td><td>{Number(r.netPnlUSDT || 0).toFixed(2)}</td></tr>)}</tbody></Table></Card></Col>

    <Col md={12}><Card body><h6>История сделок</h6><Table size="sm"><thead><tr><th>Время</th><th>Пресет</th><th>Пара</th><th>Сторона</th><th>PnL</th></tr></thead><tbody>{(app.paperTest?.trades || []).slice(0, 100).map((t, i) => <tr key={i}><td>{new Date(Number(t.ts || Date.now())).toLocaleTimeString("ru-RU")}</td><td>{t.meta?.presetName || "-"}</td><td>{t.symbol}</td><td>{t.side}</td><td>{Number(t.pnlUSDT || 0).toFixed(2)}</td></tr>)}</tbody></Table></Card></Col>

    <Col md={12}><Card body>
      <h6 className="mb-2">Обучение / Рекомендации</h6>
      <div className="small mb-1">Тест: <b>{isRunning ? "запущен" : "остановлен"}</b> • Статус: <b>{learningState}</b></div>
      <ProgressBar className="mb-2" striped={learningState === "RUNNING_WAITING"} animated={learningState === "RUNNING_WAITING"} variant={learningState === "RUNNING_IN_TRADE" ? "success" : "info"} now={learningState === "RUNNING_IN_TRADE" ? 100 : (isRunning ? 50 : 0)} />
      <div className="small mb-1">{learning.statusText || "нужно тестировать текущие настройки"}</div>
      <div ref={logRef} style={{ minHeight: 200, resize: "vertical", overflow: "auto", border: "1px solid rgba(0,0,0,0.1)", borderRadius: 8, padding: 8, background: "#fff" }}>
        {(learning.log || []).length ? (learning.log || []).map((line, idx) => <div className="small" key={idx}>{line}</div>) : <div className="small text-muted">Лог пока пуст.</div>}
      </div>
    </Card></Col>
  </Row>;
}
