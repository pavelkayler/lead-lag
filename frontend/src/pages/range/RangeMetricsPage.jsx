import { useMemo, useState } from "react";
import { Button, Card, Col, Form, Row, Table } from "react-bootstrap";
import { useApp } from "../../app/providers/AppProviders";

const defaults = { mode: "paper", maxPositions: 3, riskPerTradePct: 2, maxHoldHours: 24, minTurnover24hUSDT: 50_000_000, minATRPct15m: 0.05, staleTickerSec: 30, enableTP3: false, enable25x4: false, logNoEntryEvery10s: true };

const HELP = {
  maxPositions: "Макс. число одновременных позиций. Обычно 1-5. Слишком мало = редкие входы, слишком много = перегрузка риском.",
  riskPerTradePct: "Риск на сделку в % капитала. Обычно 0.5-2%. Мало — медленный рост, много — высокая просадка.",
  maxHoldHours: "Лимит удержания позиции в часах. Обычно 4-24. Мало — преждевременный выход, много — зависание позиции.",
  minTurnover24hUSDT: "Минимальный оборот 24ч (USDT). Обычно 10M-200M. Мало — шумные неликвиды, много — узкий выбор.",
  minATRPct15m: "Минимальный ATR(15м) в долях (0.05 = 5%). Мало — слабая волатильность, много — мало сигналов.",
  staleTickerSec: "Сколько секунд считаем тикер свежим. Обычно 15-60. Мало — частые ложные stale, много — риск торговать на старых данных.",
};

export function RangeMetricsPage() {
  const { rangeMetrics, startRangeMetrics, stopRangeMetrics, setRangeMetricsConfig } = useApp();
  const [cfg, setCfg] = useState(defaults);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [onlyDecisions, setOnlyDecisions] = useState(false);

  const logs = useMemo(() => (rangeMetrics.logs || []).filter((x) => {
    if (onlyErrors) return x.kind === "error" || x.level === "error";
    if (onlyDecisions) return String(x.msg || "").toLowerCase().includes("блокер") || x.kind === "noTrade";
    return true;
  }), [rangeMetrics.logs, onlyErrors, onlyDecisions]);

  const onChange = (k, v) => setCfg((p) => ({ ...p, [k]: v }));
  const resetAll = () => setCfg(defaults);

  return (
    <div>
      <Card className="mb-3"><Card.Body>
        <Row className="g-2 align-items-end">
          <Col md={3}><Form.Label>Режим</Form.Label><div>
            {["paper", "demo", "real"].map((m) => <Form.Check inline key={m} type="radio" label={m} checked={cfg.mode === m} onChange={() => onChange("mode", m)} />)}
          </div></Col>
          <Col md={4}><Button onClick={() => startRangeMetrics(cfg)}>Запустить</Button>{" "}<Button variant="outline-danger" onClick={() => stopRangeMetrics()}>Остановить</Button>{" "}<Button variant="outline-secondary" onClick={resetAll}>Сбросить к значениям по умолчанию</Button></Col>
          <Col md={5}>Статус: <b>{rangeMetrics.status?.state || "STOPPED"}</b> | Аптайм: {rangeMetrics.status?.uptimeSec || 0}s | Режим BTC: {rangeMetrics.status?.btcRegime || "-"}</Col>
        </Row>
      </Card.Body></Card>

      <Card className="mb-3"><Card.Body>
        <h6>Настройки (локализация + комментарии)</h6>
        <Row className="g-2">
          {Object.entries(HELP).map(([k, help]) => <Col md={4} key={k}><Form.Label>{k}</Form.Label><Form.Control type="number" value={cfg[k]} onChange={(e) => onChange(k, Number(e.target.value))} /><div className="small text-muted mt-1">{help}</div></Col>)}
          <Col md={3}><Form.Check type="checkbox" label="Включить TP3" checked={cfg.enableTP3} onChange={(e) => onChange("enableTP3", e.target.checked)} /></Col>
          <Col md={3}><Form.Check type="checkbox" label="Схема 25x4" checked={cfg.enable25x4} onChange={(e) => onChange("enable25x4", e.target.checked)} /></Col>
          <Col md={3}><Form.Check type="checkbox" label="Логировать no-entry" checked={cfg.logNoEntryEvery10s} onChange={(e) => onChange("logNoEntryEvery10s", e.target.checked)} /></Col>
        </Row>
        <div className="mt-2"><Button variant="secondary" onClick={() => setRangeMetricsConfig(cfg)}>Применить конфиг</Button></div>
      </Card.Body></Card>

      <Card className="mb-3"><Card.Body><h6>Кандидаты</h6>
        <Table size="sm" striped>
          <thead><tr><th>Символ</th><th>Скор</th><th>Сторона</th><th>Близко к S/R</th><th>VolZ</th><th>ΔOI%</th><th>LiqSpike</th><th>Funding</th><th>CVD</th><th>Блокер</th></tr></thead>
          <tbody>{(rangeMetrics.candidates || []).map((c) => <tr key={c.symbol}><td>{c.symbol}</td><td>{Number(c.score || 0).toFixed(2)}</td><td>{c.suggestedSide}</td><td>{c.nearSupport ? "S" : ""}{c.nearResistance ? "R" : ""}</td><td>{Number(c.features?.volZ || 0).toFixed(2)}</td><td>{Number(c.features?.oiDeltaPct15m || 0).toFixed(2)}</td><td>{Number(c.features?.liqSpikeLong || 0).toFixed(2)}</td><td>{Number(c.features?.fundingScore || 0).toFixed(2)}</td><td>{Number(c.features?.cvdSlope || 0).toFixed(2)}</td><td>{c.blockers?.find((b) => !b.pass)?.label || "-"}</td></tr>)}</tbody>
        </Table>
      </Card.Body></Card>

      <Row>
        <Col md={6}><Card><Card.Body><h6>Последний торговый план</h6><pre style={{ maxHeight: 250, overflow: "auto" }}>{JSON.stringify(rangeMetrics.lastPlan || {}, null, 2)}</pre></Card.Body></Card></Col>
        <Col md={6}><Card><Card.Body><h6>Причины отсутствия сделки</h6><Table size="sm"><tbody>{(rangeMetrics.noTrade?.[0]?.reasons || []).map((r) => <tr key={r.code}><td>{r.label}</td><td>{String(r.value)}</td><td>{String(r.threshold)}</td><td>{r.pass ? "PASS" : "FAIL"}</td></tr>)}</tbody></Table></Card.Body></Card></Col>
      </Row>

      <Card className="mt-3"><Card.Body>
        <h6>Диагностика свежести данных</h6>
        <pre style={{ maxHeight: 180, overflow: "auto" }}>{JSON.stringify(rangeMetrics.status?.diagnostics || {}, null, 2)}</pre>
      </Card.Body></Card>

      <Card className="mt-3"><Card.Body>
        <h6>Логи</h6>
        <Form.Check inline type="checkbox" label="Только решения" checked={onlyDecisions} onChange={(e) => setOnlyDecisions(e.target.checked)} />
        <Form.Check inline type="checkbox" label="Только ошибки" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} />
        <div style={{ minHeight: 200, maxHeight: 360, resize: "vertical", overflow: "auto", border: "1px solid #ddd", padding: 8 }}>
          {logs.map((l, i) => <div key={`${l.ts}-${i}`}><code>[{new Date(l.ts || Date.now()).toLocaleTimeString()}] {l.level || l.kind}</code> {l.symbol ? `${l.symbol}: ` : ""}{l.msg || ""}</div>)}
        </div>
      </Card.Body></Card>
    </div>
  );
}
