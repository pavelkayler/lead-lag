import { styles } from "../../../shared/ui/styles";

export function PrivateTradeCard({
  privStats,
  tradeStats,
  onConnectPrivate,
  onDisconnectPrivate,
  onConnectTrade,
  onDisconnectTrade,
  status,
}) {
  const p = privStats || {};
  const t = tradeStats || {};
  return (
    <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
      <div style={styles.card}>
        <div style={{ fontWeight: 900, marginBottom: 6 }}>Private stream</div>
        <div style={{ fontSize: 13, display: "grid", gap: 4 }}>
          <div>connected: <b>{p.connected ? "yes" : "no"}</b> / authed: <b>{p.authed ? "yes" : "no"}</b></div>
          <div>last msg age: <b>{p.lastMsgAge || "-"}</b> / reconnects: <b>{p.reconnects ?? 0}</b></div>
        </div>
        <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
          <button style={styles.btnPrimary} onClick={onConnectPrivate} disabled={status !== "connected"}>connectPrivate</button>
          <button style={styles.btn} onClick={onDisconnectPrivate} disabled={status !== "connected"}>disconnectPrivate</button>
        </div>
      </div>

      <div style={styles.card}>
        <div style={{ fontWeight: 900, marginBottom: 6 }}>Trade stream</div>
        <div style={{ fontSize: 13, display: "grid", gap: 4 }}>
          <div>connected: <b>{t.connected ? "yes" : "no"}</b> / authed: <b>{t.authed ? "yes" : "no"}</b></div>
          <div>last msg age: <b>{t.lastMsgAge || "-"}</b> / reconnects: <b>{t.reconnects ?? 0}</b></div>
        </div>
        <div style={{ marginTop: 10, display: "flex", gap: 10 }}>
          <button style={styles.btnPrimary} onClick={onConnectTrade} disabled={status !== "connected"}>connectTrade</button>
          <button style={styles.btn} onClick={onDisconnectTrade} disabled={status !== "connected"}>disconnectTrade</button>
        </div>
      </div>
    </div>
  );
}
