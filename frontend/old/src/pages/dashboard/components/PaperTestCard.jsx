import { styles } from "../../../shared/ui/styles";

export function PaperTestCard({
  status,
  onStart,
  onStop,
  onRefresh,
  canRun,
}) {
  const st = status || {};
  const running = !!st.running;

  const fmtTime = (ts) => (ts ? new Date(ts).toLocaleString() : "-");

  const totalPnl = st?.final?.totalPnlUSDT != null ? st.final.totalPnlUSDT.toFixed(2) : null;

  return (
    <div style={{ marginTop: 12, ...styles.card }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 900 }}>8h Paper Test (hourly presets)</div>
          <div style={{ fontSize: 13, opacity: 0.85, marginTop: 4 }}>
            One button run: builds 30-symbol universe (CMC market cap ≥ 10m if CMC_API_KEY set; else Bybit turnover fallback), rotates paper params every hour, writes JSONL to backend/recordings/.
          </div>
        </div>

        <div style={{ fontSize: 12, opacity: 0.85 }}>
          runId: <b>{st.runId || "-"}</b>
        </div>
      </div>

      <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        {!running ? (
          <button style={styles.btnPrimary} onClick={onStart} disabled={!canRun}>Start 8h test</button>
        ) : (
          <button style={styles.btnDanger} onClick={onStop} disabled={!canRun}>Stop</button>
        )}
        <button style={styles.btn} onClick={onRefresh} disabled={!canRun}>Refresh status</button>

        <div style={{ marginLeft: "auto", fontSize: 13, opacity: 0.9 }}>
          state: <b>{running ? "running" : "idle"}</b> / note: <b>{st.note || "-"}</b>
        </div>
      </div>

      <div style={{ marginTop: 10, display: "grid", gap: 6, fontSize: 13 }}>
        <div>
          started: <b>{fmtTime(st.startedAt)}</b> / ends: <b>{fmtTime(st.endsAt)}</b>
        </div>
        <div>
          hour: <b>{st.hourIndex ?? 0}</b> / current preset: <b>{st.currentPreset?.name || "-"}</b>
        </div>
        <div>
          symbols: <b>{Array.isArray(st.symbols) ? st.symbols.length : 0}</b>
        </div>
        {totalPnl != null && (
          <div>
            FINAL total PnL: <b>{totalPnl} USDT</b> / trades: <b>{st.final?.trades ?? "-"}</b> / wins: <b>{st.final?.wins ?? "-"}</b> / losses: <b>{st.final?.losses ?? "-"}</b> / fees: <b>{(st.final?.feesUSDT ?? 0).toFixed(2)}</b>
          </div>
        )}
      </div>

      <div style={{ marginTop: 12 }}>
        <div style={{ fontWeight: 800, marginBottom: 6 }}>Hourly results</div>
        <div style={styles.tableWrap}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead style={styles.thead}>
              <tr>
                <th style={styles.th}>hour</th>
                <th style={styles.th}>preset</th>
                <th style={styles.th}>pnlUSDT</th>
                <th style={styles.th}>trades</th>
                <th style={styles.th}>wins</th>
                <th style={styles.th}>losses</th>
                <th style={styles.th}>fees</th>
              </tr>
            </thead>
            <tbody>
              {Array.isArray(st.results) && st.results.length ? (
                st.results.slice(-12).map((r) => (
                  <tr key={r.hour} style={styles.tr}>
                    <td style={styles.td}>{r.hour}</td>
                    <td style={{ ...styles.td, fontWeight: 800 }}>{r.preset?.name || "-"}</td>
                    <td style={styles.td}>{(r.delta?.pnlUSDT ?? 0).toFixed(2)}</td>
                    <td style={styles.td}>{r.delta?.trades ?? 0}</td>
                    <td style={styles.td}>{r.delta?.wins ?? 0}</td>
                    <td style={styles.td}>{r.delta?.losses ?? 0}</td>
                    <td style={styles.td}>{(r.delta?.feesUSDT ?? 0).toFixed(2)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td style={styles.td} colSpan={7}>No results yet</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
