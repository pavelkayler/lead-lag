import { styles } from "../../../shared/ui/styles";

function Field({ label, value, onChange, width = 90 }) {
  return (
    <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <span style={{ fontSize: 13 }}>{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} style={{ ...styles.input, width }} />
    </label>
  );
}

function Mono({ value }) {
  return (
    <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 12, whiteSpace: "pre-wrap", background: "#0b1220", color: "#e5e7eb", padding: 10, borderRadius: 10, minHeight: 120, overflow: "auto" }}>
      {value ? JSON.stringify(value, null, 2) : "-"}
    </div>
  );
}

export function PaperTradingCard({
  metricsPaper,
  paperMsg,
  paperParams,
  setPaperParams,
  onPaperStart,
  onPaperStop,
  onPaperReset,
  status,
}) {
  const params = paperMsg?.params || metricsPaper?.params || null;
  const state = paperMsg?.state || metricsPaper?.state || null;

  const enabled = (paperMsg?.params?.enabled ?? metricsPaper?.enabled) ? true : false;

  return (
    <div style={{ marginTop: 12, ...styles.card }}>
      <div style={{ fontWeight: 900, marginBottom: 6 }}>Paper trading (lead-lag)</div>

      <div style={{ fontSize: 13, display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
        <div>enabled: <b>{enabled ? "yes" : "no"}</b></div>
        <div>cashUSDT: <b>{Number.isFinite(metricsPaper?.cashUSDT) ? metricsPaper.cashUSDT.toFixed(2) : "-"}</b></div>
        <div>equityUSDT: <b>{Number.isFinite(metricsPaper?.equityUSDT) ? metricsPaper.equityUSDT.toFixed(2) : "-"}</b></div>
        <div>open: <b>{metricsPaper?.open ? "yes" : "no"}</b></div>
        <div>pnlUSDT: <b>{Number.isFinite(metricsPaper?.stats?.pnlUSDT) ? metricsPaper.stats.pnlUSDT.toFixed(2) : "-"}</b></div>
        <div>trades: <b>{metricsPaper?.stats?.trades ?? "-"}</b></div>
        <div>wins: <b>{metricsPaper?.stats?.wins ?? "-"}</b></div>
        <div>losses: <b>{metricsPaper?.stats?.losses ?? "-"}</b></div>
      </div>

      <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <Field label="qtyUSDT" value={paperParams.qtyUSDT} onChange={(v) => setPaperParams((p) => ({ ...p, qtyUSDT: v }))} width={90} />
        <Field label="minCorr" value={paperParams.minCorr} onChange={(v) => setPaperParams((p) => ({ ...p, minCorr: v }))} width={90} />
        <Field label="stdBars" value={paperParams.stdBars} onChange={(v) => setPaperParams((p) => ({ ...p, stdBars: v }))} width={90} />
        <Field label="impulseZ" value={paperParams.impulseZ} onChange={(v) => setPaperParams((p) => ({ ...p, impulseZ: v }))} width={90} />
        <Field label="tpSigma" value={paperParams.tpSigma} onChange={(v) => setPaperParams((p) => ({ ...p, tpSigma: v }))} width={90} />
        <Field label="slSigma" value={paperParams.slSigma} onChange={(v) => setPaperParams((p) => ({ ...p, slSigma: v }))} width={90} />
        <Field label="maxHoldBars" value={paperParams.maxHoldBars} onChange={(v) => setPaperParams((p) => ({ ...p, maxHoldBars: v }))} width={110} />
        <Field label="cooldownBars" value={paperParams.cooldownBars} onChange={(v) => setPaperParams((p) => ({ ...p, cooldownBars: v }))} width={110} />
        <Field label="minTpBps" value={paperParams.minTpBps} onChange={(v) => setPaperParams((p) => ({ ...p, minTpBps: v }))} width={110} />
        <Field label="minSlBps" value={paperParams.minSlBps} onChange={(v) => setPaperParams((p) => ({ ...p, minSlBps: v }))} width={110} />

        <button style={styles.btnPrimary} onClick={onPaperStart} disabled={status !== "connected"}>paperStart</button>
        <button style={styles.btn} onClick={onPaperStop} disabled={status !== "connected"}>paperStop</button>
        <button style={styles.btn} onClick={onPaperReset} disabled={status !== "connected"}>paperReset</button>
      </div>

      <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Paper params (server)</div>
          <Mono value={params} />
        </div>
        <div>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Paper state (server)</div>
          <Mono value={state} />
        </div>
      </div>

      <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
        Uses live feed mid prices (WS). For signals: subscribe <b>leadlag</b> + startFeed, then paperStart.
      </div>
    </div>
  );
}
