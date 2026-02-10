import { useMemo, useState } from "react";
import { Button, Card, Col, Form, Row, Table } from "react-bootstrap";
import { useApp } from "../../app/providers/AppProviders";

const defaults = { mode: "paper", maxPositions: 3, riskPerTradePct: 2, maxHoldHours: 24, enableTP3: false, enable25x4: false, logNoEntryEvery10s: true };

export function RangeMetricsPage() {
  const { rangeMetrics, startRangeMetrics, stopRangeMetrics, setRangeMetricsConfig } = useApp();
  const [cfg, setCfg] = useState(defaults);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [onlyDecisions, setOnlyDecisions] = useState(false);

  const logs = useMemo(() => (rangeMetrics.logs || []).filter((x) => {
    if (onlyErrors) return x.kind === "error" || x.level === "error";
    if (onlyDecisions) return String(x.msg || "").toLowerCase().includes("no entry") || x.kind === "noTrade";
    return true;
  }), [rangeMetrics.logs, onlyErrors, onlyDecisions]);

  const onChange = (k, v) => setCfg((p) => ({ ...p, [k]: v }));

  return (
    <div>
      <Card className="mb-3"><Card.Body>
        <Row className="g-2 align-items-end">
          <Col md={2}><Form.Label>Mode</Form.Label><div>
            {["paper", "demo", "real"].map((m) => <Form.Check inline key={m} type="radio" label={m} checked={cfg.mode === m} onChange={() => onChange("mode", m)} />)}
          </div></Col>
          <Col md={2}><Button onClick={() => startRangeMetrics(cfg)}>Start</Button>{" "}<Button variant="outline-danger" onClick={() => stopRangeMetrics()}>Stop</Button></Col>
          <Col md={8}>Status: <b>{rangeMetrics.status?.state || "STOPPED"}</b> | Uptime: {rangeMetrics.status?.uptimeSec || 0}s | Regime: {rangeMetrics.status?.btcRegime || "-"}</Col>
        </Row>
      </Card.Body></Card>

      <Card className="mb-3"><Card.Body>
        <Row className="g-2">
          <Col md={2}><Form.Label>maxPositions</Form.Label><Form.Control type="number" value={cfg.maxPositions} onChange={(e) => onChange("maxPositions", Number(e.target.value))} /></Col>
          <Col md={2}><Form.Label>riskPerTradePct</Form.Label><Form.Control type="number" value={cfg.riskPerTradePct} onChange={(e) => onChange("riskPerTradePct", Number(e.target.value))} /></Col>
          <Col md={2}><Form.Label>maxHoldHours</Form.Label><Form.Control type="number" value={cfg.maxHoldHours} onChange={(e) => onChange("maxHoldHours", Number(e.target.value))} /></Col>
          <Col md={2}><Form.Check type="checkbox" label="TP3" checked={cfg.enableTP3} onChange={(e) => onChange("enableTP3", e.target.checked)} /></Col>
          <Col md={2}><Form.Check type="checkbox" label="25x4" checked={cfg.enable25x4} onChange={(e) => onChange("enable25x4", e.target.checked)} /></Col>
          <Col md={2}><Form.Check type="checkbox" label="Log reasons 10s" checked={cfg.logNoEntryEvery10s} onChange={(e) => onChange("logNoEntryEvery10s", e.target.checked)} /></Col>
        </Row>
        <div className="mt-2"><Button variant="secondary" onClick={() => setRangeMetricsConfig(cfg)}>Apply config</Button></div>
      </Card.Body></Card>

      <Card className="mb-3"><Card.Body><h6>Candidates</h6>
        <Table size="sm" striped>
          <thead><tr><th>symbol</th><th>score</th><th>side</th><th>Near(S/R)</th><th>VolZ</th><th>ΔOI%</th><th>LiqSpike</th><th>funding</th><th>CVD</th><th>blocker</th></tr></thead>
          <tbody>{(rangeMetrics.candidates || []).map((c) => <tr key={c.symbol}><td>{c.symbol}</td><td>{Number(c.score || 0).toFixed(2)}</td><td>{c.suggestedSide}</td><td>{c.nearSupport ? "S" : ""}{c.nearResistance ? "R" : ""}</td><td>{Number(c.features?.volZ || 0).toFixed(2)}</td><td>{Number(c.features?.oiDeltaPct15m || 0).toFixed(2)}</td><td>{Number(c.features?.liqSpikeLong || 0).toFixed(2)}</td><td>{Number(c.features?.fundingScore || 0).toFixed(2)}</td><td>{Number(c.features?.cvdSlope || 0).toFixed(2)}</td><td>{c.blockers?.find((b) => !b.pass)?.label || "-"}</td></tr>)}</tbody>
        </Table>
      </Card.Body></Card>

      <Row>
        <Col md={6}><Card><Card.Body><h6>Latest Trade Plan</h6><pre style={{ maxHeight: 250, overflow: "auto" }}>{JSON.stringify(rangeMetrics.lastPlan || {}, null, 2)}</pre></Card.Body></Card></Col>
        <Col md={6}><Card><Card.Body><h6>NoTradeReasons</h6><Table size="sm"><tbody>{(rangeMetrics.noTrade?.[0]?.reasons || []).map((r) => <tr key={r.code}><td>{r.label}</td><td>{String(r.value)}</td><td>{String(r.threshold)}</td><td>{r.pass ? "PASS" : "FAIL"}</td></tr>)}</tbody></Table></Card.Body></Card></Col>
      </Row>

      <Card className="mt-3"><Card.Body>
        <h6>Logs</h6>
        <Form.Check inline type="checkbox" label="only decisions" checked={onlyDecisions} onChange={(e) => setOnlyDecisions(e.target.checked)} />
        <Form.Check inline type="checkbox" label="only errors" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} />
        <div style={{ minHeight: 200, maxHeight: 360, resize: "vertical", overflow: "auto", border: "1px solid #ddd", padding: 8 }}>
          {logs.map((l, i) => <div key={`${l.ts}-${i}`}><code>[{new Date(l.ts || Date.now()).toLocaleTimeString()}] {l.level || l.kind}</code> {l.symbol ? `${l.symbol}: ` : ""}{l.msg || ""}</div>)}
        </div>
      </Card.Body></Card>
    </div>
  );
}
