import { styles } from "../../../shared/ui/styles";
import { fmtMs } from "../../../shared/utils/format";

export function LatencyCard({ metrics }) {
  const feed = metrics?.feed || {};
  const hub = metrics?.hub || {};
  return (
    <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
      <div style={styles.card}>
        <div style={{ fontWeight: 900, marginBottom: 6 }}>Latency / Backpressure</div>
        <div style={{ display: "grid", gap: 4, fontSize: 13 }}>
          <div><b>WS up:</b> {feed.wsUp ? "yes" : "no"}</div>
          <div><b>Last WS msg age:</b> {feed.lastWsMsgAgeMs != null ? fmtMs(feed.lastWsMsgAgeMs) : "-"}</div>
          <div><b>Reconnects:</b> {feed.reconnects ?? 0}</div>
          <div style={{ marginTop: 6 }}><b>Bar latency</b> (bar_emit - last_tick_recv)</div>
          <div>p50: {fmtMs(feed.barLatencyP50)} / p90: {fmtMs(feed.barLatencyP90)} / p99: {fmtMs(feed.barLatencyP99)}</div>
          <div style={{ marginTop: 6 }}><b>WS delay</b> (tick_recv - exch_ts)</div>
          <div>p50: {fmtMs(feed.wsDelayP50)} / p90: {fmtMs(feed.wsDelayP90)} / p99: {fmtMs(feed.wsDelayP99)}</div>
        </div>
      </div>

      <div style={styles.card}>
        <div style={{ fontWeight: 900, marginBottom: 6 }}>WS Hub</div>
        <div style={{ display: "grid", gap: 4, fontSize: 13 }}>
          <div><b>Clients:</b> {hub.clients ?? "-"}</div>
          <div><b>Sent events:</b> {hub.sent ?? "-"}</div>
          <div><b>Dropped (backpressure):</b> {hub.dropped ?? "-"}</div>
        </div>
      </div>
    </div>
  );
}
