import { useEffect, useMemo, useState } from "react";
import { Button, Card, Col, Form, Row, Table } from "react-bootstrap";
import { useApp } from "../../app/providers/AppProviders";

const EMPTY = {
  name: "", qtyUSDT: 25, minCorr: 0.15, impulseZ: 2.2, tpSigma: 1.5, slSigma: 1.0, maxHoldBars: 20, cooldownBars: 20,
  entryStrictness: 65, useFixedLeaders: false, interExchangeArbitrage: true, riskModeEnabled: false, riskLevel: 0,
  riskImpulseMargin: 0, riskQtyMultiplier: 1, protectCoreLeaders: true, blacklistSymbols: [], blacklist: [],
  autoTune: { enabled: true, startTuningAfterMin: 12, tuningIntervalSec: 90, targetMinTradesPerHour: 1, exploreEveryFailedEvals: 100,
    bounds: { minCorr: { floor: 0.05, ceil: 0.4 }, impulseZ: { floor: 1.2, ceil: 4 }, confirmZ: { floor: 0.05, ceil: 1 }, edgeMult: { floor: 1.5, ceil: 8 } } },
};

export function PresetsPage() {
  const app = useApp();
  const [draft, setDraft] = useState(EMPTY);
  const [editingName, setEditingName] = useState("");
  const stats = app.presetStats || {};

  useEffect(() => { app.listPresets().catch(() => {}); }, []);
  const rows = useMemo(() => (app.presets || []), [app.presets]);
  const numKeys = ["qtyUSDT", "minCorr", "impulseZ", "tpSigma", "slSigma", "maxHoldBars", "cooldownBars", "entryStrictness"];

  const save = async () => {
    const name = String(draft.name || editingName || "").trim();
    if (!name) return;
    const preset = { ...draft, name, interExchangeArbEnabled: draft.interExchangeArbitrage };
    await app.savePreset(preset, { name: editingName || name });
    setDraft(EMPTY);
    setEditingName("");
  };

  return <Row className="g-3">
    <Col md={7}><Card body><h6>Пресеты</h6><Table size="sm"><thead><tr><th>Название</th><th>PnL</th><th>ROI %</th><th /></tr></thead><tbody>{rows.map((p) => <tr key={p.name}><td>{p.name}</td><td>{Number(stats[p.name]?.netPnlUSDT || 0).toFixed(2)}</td><td>{Number(stats[p.name]?.roiPct || 0).toFixed(2)}%</td><td className="d-flex gap-2"><Button size="sm" variant="outline-secondary" onClick={() => { setEditingName(p.name); setDraft({ ...EMPTY, ...p, interExchangeArbitrage: p.interExchangeArbitrage ?? p.interExchangeArbEnabled ?? true }); }}>Ред.</Button><Button size="sm" variant="outline-danger" onClick={() => app.deletePreset(p.name).catch(() => {})}>Удалить</Button></td></tr>)}</tbody></Table></Card></Col>
    <Col md={5}><Card body><h6>Настройки входа (lead-lag)</h6>
      <Form.Group className="mb-2"><Form.Label>Имя пресета</Form.Label><Form.Control value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} /></Form.Group>
      {numKeys.map((k) => <Form.Group className="mb-2" key={k}><Form.Label>{k}</Form.Label><Form.Control type="number" value={draft[k]} onChange={(e) => setDraft((d) => ({ ...d, [k]: Number(e.target.value) }))} /></Form.Group>)}
      <Form.Text className="d-block mb-2 text-muted">Corr=корреляция, Lag=задержка лидера к фолловеру, Z-score=нормированное отклонение импульса.</Form.Text>
      <Form.Check className="mb-2" type="checkbox" label="Межбиржевой арбитраж (Bybit↔Binance)" checked={draft.interExchangeArbitrage !== false} onChange={(e) => setDraft((d) => ({ ...d, interExchangeArbitrage: e.target.checked }))} />
      <Form.Check className="mb-2" type="checkbox" label="Защищать core-лидеров (BTC/ETH/SOL) от EXCLUDE" checked={draft.protectCoreLeaders !== false} onChange={(e) => setDraft((d) => ({ ...d, protectCoreLeaders: e.target.checked }))} />
      <Form.Check className="mb-2" type="checkbox" label="Risk mode включен" checked={!!draft.riskModeEnabled} onChange={(e) => setDraft((d) => ({ ...d, riskModeEnabled: e.target.checked }))} />
      <Row className="g-2 mb-2"><Col><Form.Label>Risk level (0..3)</Form.Label><Form.Control type="number" min={0} max={3} value={draft.riskLevel ?? 0} onChange={(e) => setDraft((d) => ({ ...d, riskLevel: Number(e.target.value) }))} /></Col><Col><Form.Label>riskImpulseMargin</Form.Label><Form.Control type="number" step="0.05" value={draft.riskImpulseMargin ?? 0} onChange={(e) => setDraft((d) => ({ ...d, riskImpulseMargin: Number(e.target.value) }))} /></Col></Row>
      <Row className="g-2 mb-2"><Col><Form.Label>riskQtyMultiplier</Form.Label><Form.Control type="number" step="0.05" value={draft.riskQtyMultiplier ?? 1} onChange={(e) => setDraft((d) => ({ ...d, riskQtyMultiplier: Number(e.target.value) }))} /></Col><Col><Form.Label>targetMinTradesPerHour</Form.Label><Form.Control type="number" value={draft.autoTune?.targetMinTradesPerHour ?? 1} onChange={(e) => setDraft((d) => ({ ...d, autoTune: { ...(d.autoTune || {}), targetMinTradesPerHour: Number(e.target.value) } }))} /></Col></Row>
      <h6 className="mt-2">Автонастройка (exploit/explore)</h6>
      <Form.Check className="mb-2" type="checkbox" label="Включить авто-тюнинг" checked={draft.autoTune?.enabled !== false} onChange={(e) => setDraft((d) => ({ ...d, autoTune: { ...(d.autoTune || {}), enabled: e.target.checked } }))} />
      <Row className="g-2"><Col><Form.Label>startTuningAfterMin</Form.Label><Form.Control type="number" value={draft.autoTune?.startTuningAfterMin ?? 12} onChange={(e) => setDraft((d) => ({ ...d, autoTune: { ...(d.autoTune || {}), startTuningAfterMin: Number(e.target.value) } }))} /></Col><Col><Form.Label>tuningIntervalSec</Form.Label><Form.Control type="number" value={draft.autoTune?.tuningIntervalSec ?? 90} onChange={(e) => setDraft((d) => ({ ...d, autoTune: { ...(d.autoTune || {}), tuningIntervalSec: Number(e.target.value) } }))} /></Col></Row>
      <div className="d-flex gap-2 mt-3"><Button onClick={() => save().catch(() => {})}>Сохранить</Button><Button variant="outline-secondary" onClick={() => { setDraft(EMPTY); setEditingName(""); }}>Сброс</Button></div>
    </Card></Col>
  </Row>;
}
