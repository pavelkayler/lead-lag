import { styles } from "../../../shared/ui/styles";

export function ConnectionBar({
  wsUrl,
  setWsUrl,
  status,
  clientId,
  onConnect,
  onDisconnect,
  symbolsInput,
  setSymbolsInput,
  onSetSymbols,
  onStartFeed,
  onStopFeed,
}) {
  return (
    <div style={{ ...styles.card, marginTop: 12 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ fontWeight: 800 }}>Status: {status}</div>
        <div style={{ opacity: 0.8, fontSize: 13 }}>ClientId: {clientId || "-"}</div>
      </div>

      <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          WS URL
          <input value={wsUrl} onChange={(e) => setWsUrl(e.target.value)} style={{ ...styles.input, width: 240 }} />
        </label>

        {status !== "connected" ? (
          <button style={styles.btnPrimary} onClick={onConnect}>Connect</button>
        ) : (
          <button style={styles.btn} onClick={onDisconnect}>Disconnect</button>
        )}

        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          Symbols (≤5)
          <input
            value={symbolsInput}
            onChange={(e) => setSymbolsInput(e.target.value)}
            placeholder="BTCUSDT,ETHUSDT,..."
            style={{ ...styles.input, width: 420 }}
          />
        </label>

        <button style={styles.btn} onClick={onSetSymbols} disabled={status !== "connected"}>
          setSymbols
        </button>

        <button style={styles.btnPrimary} onClick={onStartFeed} disabled={status !== "connected"}>
          startFeed
        </button>

        <button style={styles.btn} onClick={onStopFeed} disabled={status !== "connected"}>
          stopFeed
        </button>
      </div>
    </div>
  );
}
