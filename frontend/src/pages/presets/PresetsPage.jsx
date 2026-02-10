import { useEffect, useMemo, useState } from "react";
import { Button, Card, Col, Form, Row, Table } from "react-bootstrap";
import { useApp } from "../../app/providers/AppProviders";

const EMPTY = { name: "", qtyUSDT: 25, minCorr: 0.15, impulseZ: 2.2, tpSigma: 1.5, slSigma: 1.0, maxHoldBars: 20, cooldownBars: 20, entryStrictness: 65 };

export function PresetsPage() {
  const app = useApp();
  const [draft, setDraft] = useState(EMPTY);
  const stats = app.presetStats || {};

  useEffect(() => { app.listPresets().catch(() => {}); }, []);

  const rows = useMemo(() => (app.presets || []), [app.presets]);

  const save = async () => {
    await app.savePreset({ ...draft, name: String(draft.name || "").trim() });
    setDraft(EMPTY);
  };

  return <Row className="g-3">
    <Col md={7}><Card body><h6>Пресеты</h6><Table size="sm"><thead><tr><th>Название</th><th>PnL</th><th>ROI %</th><th /></tr></thead><tbody>{rows.map((p) => <tr key={p.name}><td>{p.name}</td><td style={{ fontVariantNumeric: "tabular-nums" }}>{Number(stats[p.name]?.netPnlUSDT || 0).toFixed(2)} USDT</td><td style={{ fontVariantNumeric: "tabular-nums" }}>{Number(stats[p.name]?.roiPct || 0).toFixed(2)}%</td><td className="d-flex gap-2"><Button size="sm" variant="outline-secondary" onClick={() => setDraft(p)}>Ред.</Button><Button size="sm" variant="outline-danger" onClick={() => app.deletePreset(p.name).catch(() => {})}>Удалить</Button></td></tr>)}</tbody></Table></Card></Col>
    <Col md={5}><Card body><h6>{draft.name ? "Редактирование" : "Создание"}</h6>
      <Form.Group className="mb-2"><Form.Label>Имя</Form.Label><Form.Control value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} /></Form.Group>
      {Object.entries(draft).filter(([k]) => k !== "name").map(([k, v]) => <Form.Group className="mb-2" key={k}><Form.Label>{k}</Form.Label><Form.Control type="number" value={v} onChange={(e) => setDraft((d) => ({ ...d, [k]: Number(e.target.value) }))} /></Form.Group>)}
      <Form.Label>Строгость входа: {draft.entryStrictness}</Form.Label><Form.Range min={0} max={100} value={draft.entryStrictness} onChange={(e) => setDraft((d) => ({ ...d, entryStrictness: Number(e.target.value) }))} />
      <div className="d-flex gap-2"><Button onClick={() => save().catch(() => {})}>Сохранить</Button><Button variant="outline-secondary" onClick={() => setDraft(EMPTY)}>Сброс</Button></div>
    </Card></Col>
  </Row>;
}
