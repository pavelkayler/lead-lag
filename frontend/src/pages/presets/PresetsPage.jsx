import { useEffect, useMemo, useState } from "react";
import { Button, Card, Col, Form, Row, Table } from "react-bootstrap";
import { useApp } from "../../app/providers/AppProviders";

const EMPTY = { name: "", qtyUSDT: 25, minCorr: 0.15, impulseZ: 2.2, tpSigma: 1.5, slSigma: 1.0, maxHoldBars: 20, cooldownBars: 20, entryStrictness: 65, useFixedLeaders: false, blacklistSymbols: [], blacklist: [], autoTune: { enabled: true, startTuningAfterMin: 12, tuningIntervalSec: 90, targetMinTradesPerHour: 1, bounds: { minCorr: { floor: 0.05, ceil: 0.4 }, impulseZ: { floor: 1.2, ceil: 4 }, confirmZ: { floor: 0.05, ceil: 1 }, edgeMult: { floor: 1.5, ceil: 8 } } } };

export function PresetsPage() {
  const app = useApp();
  const [draft, setDraft] = useState(EMPTY);
  const [excludeSym, setExcludeSym] = useState("");
  const [srcBT, setSrcBT] = useState(true);
  const [srcBNB, setSrcBNB] = useState(true);
  const [editingName, setEditingName] = useState("");
  const stats = app.presetStats || {};

  useEffect(() => { app.listPresets().catch(() => {}); }, []);

  const rows = useMemo(() => (app.presets || []), [app.presets]);

  const save = async () => {
    const blacklist = (draft.blacklist || []).map((x) => ({ ...x, symbol: String(x.symbol || "").toUpperCase() })).filter((x) => x.symbol);
    const name = String(draft.name || "").trim();
    const routeName = String(editingName || name).trim();
    await app.savePreset({ ...draft, name: name || routeName, blacklist, blacklistSymbols: Array.from(new Set(blacklist.map((x) => x.symbol))) }, { name: routeName });
    setDraft(EMPTY);
    setEditingName("");
    setExcludeSym("");
  };

  const numericKeys = ["qtyUSDT", "minCorr", "impulseZ", "tpSigma", "slSigma", "maxHoldBars", "cooldownBars", "entryStrictness"];

  return <Row className="g-3">
    <Col md={7}><Card body><h6>Пресеты</h6><Table size="sm"><thead><tr><th>Название</th><th>PnL</th><th>ROI %</th><th /></tr></thead><tbody>{rows.map((p) => <tr key={p.name}><td>{p.name}</td><td style={{ fontVariantNumeric: "tabular-nums" }}>{Number(stats[p.name]?.netPnlUSDT || 0).toFixed(2)} USDT</td><td style={{ fontVariantNumeric: "tabular-nums" }}>{Number(stats[p.name]?.roiPct || 0).toFixed(2)}%</td><td className="d-flex gap-2"><Button size="sm" variant="outline-secondary" onClick={() => { setEditingName(p.name); setDraft({ ...EMPTY, ...p, blacklist: p.blacklist || (p.blacklistSymbols || []).map((x) => ({ symbol: x, sources: ["BT", "BNB"] })), blacklistSymbols: p.blacklistSymbols || [] }); }}>Ред.</Button><Button size="sm" variant="outline-danger" onClick={() => app.deletePreset(p.name).catch(() => {})}>Удалить</Button></td></tr>)}</tbody></Table></Card></Col>
    <Col md={5}><Card body><h6>{draft.name ? "Редактирование" : "Создание"}</h6>
      <Form.Group className="mb-2"><Form.Label>Имя</Form.Label><Form.Control value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} /></Form.Group>
      {numericKeys.map((k) => <Form.Group className="mb-2" key={k}><Form.Label>{k}: {draft[k]}</Form.Label><div className="d-flex gap-2"><Form.Range min={k === "entryStrictness" ? 0 : 0} max={k === "entryStrictness" ? 100 : 300} value={draft[k]} onChange={(e) => setDraft((d) => ({ ...d, [k]: Number(e.target.value) }))} /><Form.Control style={{ maxWidth: 120 }} type="number" value={draft[k]} onChange={(e) => setDraft((d) => ({ ...d, [k]: Number(e.target.value) }))} /></div></Form.Group>)}
      <Form.Check className="mb-2" type="checkbox" label="Фиксированные лидеры BTC/ETH/SOL" checked={!!draft.useFixedLeaders} onChange={(e) => setDraft((d) => ({ ...d, useFixedLeaders: e.target.checked }))} />

      <h6 className="mt-3">Автонастройка порогов</h6>
      <Form.Check className="mb-2" type="checkbox" label="Включить автонастройку" checked={draft.autoTune?.enabled !== false} onChange={(e) => setDraft((d) => ({ ...d, autoTune: { ...(d.autoTune || {}), enabled: e.target.checked } }))} />
      <Row className="g-2 mb-2">
        <Col md={6}><Form.Label>Старт через (мин)</Form.Label><Form.Control type="number" value={draft.autoTune?.startTuningAfterMin ?? 12} onChange={(e) => setDraft((d) => ({ ...d, autoTune: { ...(d.autoTune || {}), startTuningAfterMin: Number(e.target.value) } }))} /></Col>
        <Col md={6}><Form.Label>Интервал подстройки (сек)</Form.Label><Form.Control type="number" value={draft.autoTune?.tuningIntervalSec ?? 90} onChange={(e) => setDraft((d) => ({ ...d, autoTune: { ...(d.autoTune || {}), tuningIntervalSec: Number(e.target.value) } }))} /></Col>
        <Col md={12}><Form.Label>Цель: минимум сделок в час</Form.Label><Form.Control type="number" value={draft.autoTune?.targetMinTradesPerHour ?? 1} onChange={(e) => setDraft((d) => ({ ...d, autoTune: { ...(d.autoTune || {}), targetMinTradesPerHour: Number(e.target.value) } }))} /></Col>
      </Row>
      <Row className="g-2 mb-2">
        <Col md={6}><Form.Label>Пределы minCorr (минимум/максимум)</Form.Label><div className="d-flex gap-1"><Form.Control type="number" step="0.01" value={draft.autoTune?.bounds?.minCorr?.floor ?? 0.05} onChange={(e) => setDraft((d) => ({ ...d, autoTune: { ...(d.autoTune || {}), bounds: { ...(d.autoTune?.bounds || {}), minCorr: { ...(d.autoTune?.bounds?.minCorr || {}), floor: Number(e.target.value) } } } }))} /><Form.Control type="number" step="0.01" value={draft.autoTune?.bounds?.minCorr?.ceil ?? 0.4} onChange={(e) => setDraft((d) => ({ ...d, autoTune: { ...(d.autoTune || {}), bounds: { ...(d.autoTune?.bounds || {}), minCorr: { ...(d.autoTune?.bounds?.minCorr || {}), ceil: Number(e.target.value) } } } }))} /></div></Col>
        <Col md={6}><Form.Label>Пределы impulseZ (минимум/максимум)</Form.Label><div className="d-flex gap-1"><Form.Control type="number" step="0.1" value={draft.autoTune?.bounds?.impulseZ?.floor ?? 1.2} onChange={(e) => setDraft((d) => ({ ...d, autoTune: { ...(d.autoTune || {}), bounds: { ...(d.autoTune?.bounds || {}), impulseZ: { ...(d.autoTune?.bounds?.impulseZ || {}), floor: Number(e.target.value) } } } }))} /><Form.Control type="number" step="0.1" value={draft.autoTune?.bounds?.impulseZ?.ceil ?? 4} onChange={(e) => setDraft((d) => ({ ...d, autoTune: { ...(d.autoTune || {}), bounds: { ...(d.autoTune?.bounds || {}), impulseZ: { ...(d.autoTune?.bounds?.impulseZ || {}), ceil: Number(e.target.value) } } } }))} /></div></Col>
        <Col md={6}><Form.Label>Пределы confirmZ (минимум/максимум)</Form.Label><div className="d-flex gap-1"><Form.Control type="number" step="0.01" value={draft.autoTune?.bounds?.confirmZ?.floor ?? 0.05} onChange={(e) => setDraft((d) => ({ ...d, autoTune: { ...(d.autoTune || {}), bounds: { ...(d.autoTune?.bounds || {}), confirmZ: { ...(d.autoTune?.bounds?.confirmZ || {}), floor: Number(e.target.value) } } } }))} /><Form.Control type="number" step="0.01" value={draft.autoTune?.bounds?.confirmZ?.ceil ?? 1} onChange={(e) => setDraft((d) => ({ ...d, autoTune: { ...(d.autoTune || {}), bounds: { ...(d.autoTune?.bounds || {}), confirmZ: { ...(d.autoTune?.bounds?.confirmZ || {}), ceil: Number(e.target.value) } } } }))} /></div></Col>
        <Col md={6}><Form.Label>Пределы edgeMult (минимум/максимум)</Form.Label><div className="d-flex gap-1"><Form.Control type="number" step="0.1" value={draft.autoTune?.bounds?.edgeMult?.floor ?? 1.5} onChange={(e) => setDraft((d) => ({ ...d, autoTune: { ...(d.autoTune || {}), bounds: { ...(d.autoTune?.bounds || {}), edgeMult: { ...(d.autoTune?.bounds?.edgeMult || {}), floor: Number(e.target.value) } } } }))} /><Form.Control type="number" step="0.1" value={draft.autoTune?.bounds?.edgeMult?.ceil ?? 8} onChange={(e) => setDraft((d) => ({ ...d, autoTune: { ...(d.autoTune || {}), bounds: { ...(d.autoTune?.bounds || {}), edgeMult: { ...(d.autoTune?.bounds?.edgeMult || {}), ceil: Number(e.target.value) } } } }))} /></div></Col>
      </Row>
      <h6 className="mt-3">Исключения монет</h6>
      <div className="d-flex gap-2 mb-2"><Form.Control placeholder="Напр. XRPUSDT" value={excludeSym} onChange={(e) => setExcludeSym(e.target.value.toUpperCase())} /><Form.Check label="BT" checked={srcBT} onChange={(e) => setSrcBT(e.target.checked)} /><Form.Check label="BNB" checked={srcBNB} onChange={(e) => setSrcBNB(e.target.checked)} /><Button size="sm" onClick={() => setDraft((d) => { const sym = String(excludeSym || "").toUpperCase().trim(); if (!sym) return d; const sources = [srcBT ? "BT" : null, srcBNB ? "BNB" : null].filter(Boolean); const item = { symbol: sym, sources }; const blacklist = [...(d.blacklist || []).filter((x) => x.symbol !== sym), item]; return ({ ...d, blacklist, blacklistSymbols: Array.from(new Set(blacklist.map((x) => x.symbol))) }); })}>Добавить</Button></div>
      <div className="mb-3">{(draft.blacklist || []).map((b) => <div key={b.symbol} className="d-flex align-items-center gap-2 mb-1"><code>{b.symbol}</code><Form.Check inline label="BT" checked={(b.sources || []).includes("BT")} onChange={(e) => setDraft((d) => ({ ...d, blacklist: (d.blacklist || []).map((x) => x.symbol !== b.symbol ? x : ({ ...x, sources: e.target.checked ? Array.from(new Set([...(x.sources || []), "BT"])) : (x.sources || []).filter((z) => z !== "BT") })) }))} /><Form.Check inline label="BNB" checked={(b.sources || []).includes("BNB")} onChange={(e) => setDraft((d) => ({ ...d, blacklist: (d.blacklist || []).map((x) => x.symbol !== b.symbol ? x : ({ ...x, sources: e.target.checked ? Array.from(new Set([...(x.sources || []), "BNB"])) : (x.sources || []).filter((z) => z !== "BNB") })) }))} /><Button size="sm" variant="outline-danger" onClick={() => setDraft((d) => ({ ...d, blacklist: (d.blacklist || []).filter((x) => x.symbol !== b.symbol), blacklistSymbols: (d.blacklistSymbols || []).filter((x) => x !== b.symbol) }))}>Удалить</Button></div>)}</div>
      <div className="d-flex gap-2"><Button onClick={() => save().catch(() => {})}>Сохранить</Button><Button variant="outline-secondary" onClick={() => { setDraft(EMPTY); setEditingName(""); }}>Сброс</Button></div>
    </Card></Col>
  </Row>;
}
