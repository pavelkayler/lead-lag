import { useEffect, useMemo, useState } from "react";
import { Button, Card, Col, Form, Row, Table } from "react-bootstrap";
import { useApp } from "../../app/providers/AppProviders";

const EMPTY = { name: "", qtyUSDT: 25, minCorr: 0.15, impulseZ: 2.2, tpSigma: 1.5, slSigma: 1.0, maxHoldBars: 20, cooldownBars: 20, entryStrictness: 65, blacklistSymbols: [] };

export function PresetsPage() {
  const app = useApp();
  const [draft, setDraft] = useState(EMPTY);
  const [excludeSym, setExcludeSym] = useState("");
  const stats = app.presetStats || {};

  useEffect(() => { app.listPresets().catch(() => {}); }, []);

  const rows = useMemo(() => (app.presets || []), [app.presets]);

  const save = async () => {
    await app.savePreset({ ...draft, name: String(draft.name || "").trim(), blacklistSymbols: Array.from(new Set(draft.blacklistSymbols || [])) });
    setDraft(EMPTY);
    setExcludeSym("");
  };

  const numericKeys = ["qtyUSDT", "minCorr", "impulseZ", "tpSigma", "slSigma", "maxHoldBars", "cooldownBars", "entryStrictness"];

  return <Row className="g-3">
    <Col md={7}><Card body><h6>Пресеты</h6><Table size="sm"><thead><tr><th>Название</th><th>PnL</th><th>ROI %</th><th /></tr></thead><tbody>{rows.map((p) => <tr key={p.name}><td>{p.name}</td><td style={{ fontVariantNumeric: "tabular-nums" }}>{Number(stats[p.name]?.netPnlUSDT || 0).toFixed(2)} USDT</td><td style={{ fontVariantNumeric: "tabular-nums" }}>{Number(stats[p.name]?.roiPct || 0).toFixed(2)}%</td><td className="d-flex gap-2"><Button size="sm" variant="outline-secondary" onClick={() => setDraft({ ...EMPTY, ...p, blacklistSymbols: p.blacklistSymbols || [] })}>Ред.</Button><Button size="sm" variant="outline-danger" onClick={() => app.deletePreset(p.name).catch(() => {})}>Удалить</Button></td></tr>)}</tbody></Table></Card></Col>
    <Col md={5}><Card body><h6>{draft.name ? "Редактирование" : "Создание"}</h6>
      <Form.Group className="mb-2"><Form.Label>Имя</Form.Label><Form.Control value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} /></Form.Group>
      {numericKeys.map((k) => <Form.Group className="mb-2" key={k}><Form.Label>{k}: {draft[k]}</Form.Label><div className="d-flex gap-2"><Form.Range min={k === "entryStrictness" ? 0 : 0} max={k === "entryStrictness" ? 100 : 300} value={draft[k]} onChange={(e) => setDraft((d) => ({ ...d, [k]: Number(e.target.value) }))} /><Form.Control style={{ maxWidth: 120 }} type="number" value={draft[k]} onChange={(e) => setDraft((d) => ({ ...d, [k]: Number(e.target.value) }))} /></div></Form.Group>)}
      <h6 className="mt-3">Исключения монет</h6>
      <div className="d-flex gap-2 mb-2"><Form.Control placeholder="Напр. XRPUSDT" value={excludeSym} onChange={(e) => setExcludeSym(e.target.value.toUpperCase())} /><Button size="sm" onClick={() => setDraft((d) => ({ ...d, blacklistSymbols: Array.from(new Set([...(d.blacklistSymbols || []), excludeSym])) }))}>Добавить</Button></div>
      <div className="d-flex gap-2 flex-wrap mb-3">{(draft.blacklistSymbols || []).map((s) => <Button key={s} size="sm" variant="outline-danger" onClick={() => setDraft((d) => ({ ...d, blacklistSymbols: (d.blacklistSymbols || []).filter((x) => x !== s) }))}>{s} ✕</Button>)}</div>
      <div className="d-flex gap-2"><Button onClick={() => save().catch(() => {})}>Сохранить</Button><Button variant="outline-secondary" onClick={() => setDraft(EMPTY)}>Сброс</Button></div>
    </Card></Col>
  </Row>;
}
