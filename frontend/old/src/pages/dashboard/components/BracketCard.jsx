import { styles } from "../../../shared/ui/styles";

export function BracketCard({
  knownSymbols,
  brSymbol,
  setBrSymbol,
  brSide,
  setBrSide,
  brQtyUSDT,
  setBrQtyUSDT,
  brTpPct,
  setBrTpPct,
  brSlPct,
  setBrSlPct,
  brTriggerBy,
  setBrTriggerBy,
  onPlaceBracket,
  status,
  risk,
}) {
  return (
    <div style={{ marginTop: 12, ...styles.card }}>
      <div style={{ fontWeight: 900, marginBottom: 6 }}>Bracket (Market) order</div>
      <div style={{ opacity: 0.8, fontSize: 13 }}>
        Market entry + attached TP/SL. Uses triggerBy: <b>{brTriggerBy}</b>.
      </div>

      <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          symbol
          <select value={brSymbol} onChange={(e) => setBrSymbol(e.target.value)} style={styles.input}>
            {knownSymbols.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>

        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          side
          <select value={brSide} onChange={(e) => setBrSide(e.target.value)} style={styles.input}>
            <option value="Buy">Buy</option>
            <option value="Sell">Sell</option>
          </select>
        </label>

        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          qtyUSDT
          <input value={brQtyUSDT} onChange={(e) => setBrQtyUSDT(e.target.value)} style={{ ...styles.input, width: 110 }} />
        </label>

        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          TP %
          <input value={brTpPct} onChange={(e) => setBrTpPct(e.target.value)} style={{ ...styles.input, width: 90 }} />
        </label>

        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          SL %
          <input value={brSlPct} onChange={(e) => setBrSlPct(e.target.value)} style={{ ...styles.input, width: 90 }} />
        </label>

        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          triggerBy
          <select value={brTriggerBy} onChange={(e) => setBrTriggerBy(e.target.value)} style={styles.input}>
            <option value="MarkPrice">MarkPrice</option>
            <option value="LastPrice">LastPrice</option>
            <option value="IndexPrice">IndexPrice</option>
          </select>
        </label>

        <button style={styles.btnPrimary} onClick={onPlaceBracket} disabled={status !== "connected" || !risk?.enableTrading || risk?.haltTrading}>
          placeBracket
        </button>

        <div style={{ marginLeft: "auto", fontSize: 13, opacity: 0.85 }}>
          trading enabled: <b>{risk?.enableTrading ? "yes" : "no"}</b> / halted: <b>{risk?.haltTrading ? "yes" : "no"}</b>
        </div>
      </div>
    </div>
  );
}
