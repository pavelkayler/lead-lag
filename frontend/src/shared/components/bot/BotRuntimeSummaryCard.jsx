import { Badge, Card, Col, Row } from "react-bootstrap";

function fmtTs(ts) {
  if (!Number.isFinite(Number(ts)) || Number(ts) <= 0) return "-";
  return new Date(Number(ts)).toLocaleString();
}

function fmtDurationSec(sec) {
  const v = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(v / 3600);
  const m = Math.floor((v % 3600) / 60);
  const s = v % 60;
  return `${h}h ${m}m ${s}s`;
}

export function BotRuntimeSummaryCard({ status, mode = "paper", paperState, walletUSDT, nowTs = Date.now() }) {
  const isRunning = String(status?.state || "").toUpperCase() === "RUNNING";
  const startedAt = Number(status?.startedAt || 0);
  const durationSec = isRunning && startedAt ? (nowTs - startedAt) / 1000 : 0;
  const balance = mode === "paper" ? Number(paperState?.cashUSDT) : Number(walletUSDT?.availableToWithdraw ?? walletUSDT?.availableBalance);
  const equity = mode === "paper" ? Number(paperState?.equityUSDT) : Number(walletUSDT?.equity ?? walletUSDT?.walletBalance);

  return <Card body className="mb-3">
    <div className="d-flex justify-content-between align-items-center mb-2">
      <h6 className="mb-0">Сводка runtime</h6>
      <Badge bg={isRunning ? "success" : "secondary"}>{status?.state || "STOPPED"}</Badge>
    </div>
    <Row className="g-2 small">
      <Col md={4}><div>mode: <b>{mode || "-"}</b></div><div>symbol: <b>{status?.symbol || "-"}</b></div><div>side: <b>{status?.currentSide || "-"}</b></div></Col>
      <Col md={4}><div>balance: <b>{Number.isFinite(balance) ? balance.toFixed(2) : "-"}</b></div><div>equity: <b>{Number.isFinite(equity) ? equity.toFixed(2) : "-"}</b></div><div>cycleId: <b>{status?.cycleId ?? 0}</b></div></Col>
      <Col md={4}><div>startedAt: <b>{fmtTs(startedAt)}</b></div><div>duration: <b>{fmtDurationSec(durationSec)}</b></div><div>updatedAt: <b>{fmtTs(status?.updatedAt)}</b></div></Col>
    </Row>
    <div className="small mt-2">reason: <b>{status?.lastCycleReason || "-"}</b> • boundary: <b>{status?.boundaryPrice ?? "-"}</b> • upper/lower: <b>{status?.upper ?? "-"}</b>/<b>{status?.lower ?? "-"}</b></div>
  </Card>;
}
