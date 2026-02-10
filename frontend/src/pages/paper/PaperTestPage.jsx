import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Col, Form, ProgressBar, Row, Table, Toast, ToastContainer } from "react-bootstrap";
import { useApp } from "../../app/providers/AppProviders";

export function PaperTestPage() {
  const app = useApp();
  const [durationHours, setDurationHours] = useState(1);
  const [selectedPresetIds, setSelectedPresetIds] = useState([]);
  const [multiStrategy, setMultiStrategy] = useState(true);
  const [exploitBest, setExploitBest] = useState(true);
  const [isolatedPresetName, setIsolatedPresetName] = useState("");
  const [entryStrictness, setEntryStrictness] = useState(65);
  const [showToast, setShowToast] = useState(false);

  const presets = app.presets || [];
  useEffect(() => {
    if (!presets.length) return;
    if (!selectedPresetIds.length) setSelectedPresetIds(presets.map((p) => p.name));
    if (!isolatedPresetName) setIsolatedPresetName(presets[0].name);
  }, [presets, selectedPresetIds.length, isolatedPresetName]);

  const learning = app.paperTest?.learning || {};
  const learningState = learning.state || app.paperTest?.state || "STOPPED";
  const isRunning = learningState !== "STOPPED";

  const selectedPresets = useMemo(() => presets.filter((p) => selectedPresetIds.includes(p.name)), [presets, selectedPresetIds]);

  const start = async () => {
    const presetsPayload = multiStrategy ? selectedPresets : [presets.find((p) => p.name === isolatedPresetName)].filter(Boolean);
    await app.startPaperTest({ durationHours, rotateEveryMinutes: 60, symbolsCount: 100, minMarketCapUsd: 10_000_000, presets: presetsPayload, multiStrategy, exploitBest, isolatedPresetName, entryStrictness });
    setShowToast(true);
  };

  return <>
    <ToastContainer position="top-end" className="p-2"><Toast bg="success" delay={1000} show={showToast} autohide onClose={() => setShowToast(false)}><Toast.Body className="text-white">Тест запущен</Toast.Body></Toast></ToastContainer>
    <Row className="g-3">
      <Col md={12}><Card body>
        <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2"><h6 className="mb-0">Paper Test</h6><Badge bg={isRunning ? "success" : "secondary"}>{isRunning ? "Тест запущен" : "Тест остановлен"}</Badge></div>
        <Form.Label className="mb-1">Длительность (часы): {durationHours}</Form.Label><Form.Range min={1} max={24} value={durationHours} onChange={(e) => setDurationHours(Number(e.target.value))} />
        <Form.Label className="mb-1">Строгость входа / Частота входов: {entryStrictness}</Form.Label><Form.Range min={0} max={100} value={entryStrictness} onChange={(e) => setEntryStrictness(Number(e.target.value))} />
        <div className="d-flex gap-4 flex-wrap mb-2"><Form.Check type="checkbox" label="Мульти-стратегия (параллельно)" checked={multiStrategy} onChange={(e) => setMultiStrategy(e.target.checked)} /><Form.Check type="checkbox" label="Эксплуатация лучшего" checked={exploitBest} onChange={(e) => setExploitBest(e.target.checked)} /></div>
        {!multiStrategy && <Form.Group className="mb-2"><Form.Label>Тестировать только пресет</Form.Label><Form.Select value={isolatedPresetName} onChange={(e) => setIsolatedPresetName(e.target.value)} style={{ maxWidth: 280 }}>{presets.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}</Form.Select></Form.Group>}
        <div className="d-flex gap-2 flex-wrap mb-2">{presets.map((p) => <Form.Check key={p.name} type="checkbox" label={p.name} checked={selectedPresetIds.includes(p.name)} onChange={(e) => setSelectedPresetIds((old) => e.target.checked ? [...new Set([...old, p.name])] : old.filter((id) => id !== p.name))} />)}</div>
        <div className="d-flex gap-2 flex-wrap"><Button onClick={() => start().catch(() => {})}>Запустить тест</Button><Button variant="outline-danger" onClick={() => app.stopPaperTest().catch(() => {})}>Остановить</Button><Button variant="outline-secondary" onClick={() => app.sendCommand("resetLearning", {}).catch(() => {})}>Сбросить историю</Button></div>
      </Card></Col>

      <Col md={12}><Card body><h6>История сделок</h6><Table size="sm"><thead><tr><th>Время</th><th>Пресет</th><th>Пара</th><th>Сторона</th><th>PnL</th></tr></thead><tbody>{(app.paperTest?.trades || []).slice(0, 100).map((t, i) => <tr key={i}><td>{new Date(Number(t.ts || Date.now())).toLocaleTimeString("ru-RU")}</td><td>{t.meta?.presetName || "-"}</td><td>{t.symbol}</td><td>{t.side}</td><td style={{ fontVariantNumeric: "tabular-nums" }}>{Number(t.pnlUSDT || 0).toFixed(2)}</td></tr>)}</tbody></Table></Card></Col>

      <Col md={12}><Card body>
        <h6 className="mb-2">Обучение / Рекомендации</h6>
        <div className="small mb-1">Тест: <b>{isRunning ? "запущен" : "остановлен"}</b> • Статус: <b>{learningState}</b></div>
        <ProgressBar className="mb-2" striped={learningState === "RUNNING_WAITING"} animated={learningState === "RUNNING_WAITING"} variant={learningState === "RUNNING_IN_TRADE" ? "success" : "info"} now={learningState === "RUNNING_IN_TRADE" ? 100 : (isRunning ? 50 : 0)} />
        <div style={{ minHeight: 200, resize: "vertical", overflow: "auto", border: "1px solid rgba(0,0,0,0.1)", borderRadius: 8, padding: 8, background: "#fff" }}>
          {(learning.log || []).length ? [...(learning.log || [])].reverse().map((line, idx) => <div className="small" key={idx}>{line}</div>) : <div className="small text-muted">Лог пока пуст.</div>}
        </div>
      </Card></Col>
    </Row>
  </>;
}
