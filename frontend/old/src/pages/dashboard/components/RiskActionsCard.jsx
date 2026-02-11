import { styles } from "../../../shared/ui/styles";

export function RiskActionsCard({
  killReason,
  setKillReason,
  onCancelAll,
  onCloseAll,
  onKillSwitchOn,
  onKillSwitchOff,
  status,
  symbolHint,
}) {
  return (
    <div style={{ marginTop: 12, ...styles.card }}>
      <div style={{ fontWeight: 900, marginBottom: 6 }}>Risk actions</div>
      <div style={{ opacity: 0.8, fontSize: 13 }}>cancelAll / closeAll / killSwitch (server-side runtime halt)</div>

      <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button style={styles.btn} onClick={() => onCancelAll(null)} disabled={status !== "connected"}>cancelAll (all)</button>
        <button style={styles.btn} onClick={() => onCancelAll(symbolHint)} disabled={status !== "connected"}>cancelAll ({symbolHint})</button>
        <button style={styles.btn} onClick={() => onCloseAll(null)} disabled={status !== "connected"}>closeAll (all)</button>
        <button style={styles.btn} onClick={() => onCloseAll(symbolHint)} disabled={status !== "connected"}>closeAll ({symbolHint})</button>

        <label style={{ display: "flex", gap: 6, alignItems: "center", marginLeft: 10 }}>
          reason
          <input value={killReason} onChange={(e) => setKillReason(e.target.value)} style={{ ...styles.input, width: 220 }} />
        </label>

        <button style={styles.btnDanger} onClick={onKillSwitchOn} disabled={status !== "connected"}>killSwitch ON</button>
        <button style={styles.btn} onClick={onKillSwitchOff} disabled={status !== "connected"}>killSwitch OFF</button>
      </div>
    </div>
  );
}
