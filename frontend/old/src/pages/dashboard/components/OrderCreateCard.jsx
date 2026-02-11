import { styles } from "../../../shared/ui/styles";

export function OrderCreateCard({
  knownSymbols,
  orderSymbol,
  setOrderSymbol,
  orderSide,
  setOrderSide,
  orderType,
  setOrderType,
  orderQty,
  setOrderQty,
  orderPrice,
  setOrderPrice,
  onPlaceOrder,
  status,
  risk,
}) {
  return (
    <div style={{ marginTop: 12, ...styles.card }}>
      <div style={{ fontWeight: 900 }}>Order.create test (server-gated)</div>
      <div style={{ opacity: 0.8, fontSize: 13, marginTop: 6 }}>
        Requires backend env: <b>BYBIT_API_KEY</b>, <b>BYBIT_API_SECRET</b>, and <b>ENABLE_TRADING=1</b>.
        Limit orders also checked against <b>MAX_NOTIONAL_USDT</b>.
      </div>

      <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          symbol
          <select value={orderSymbol} onChange={(e) => setOrderSymbol(e.target.value)} style={styles.input}>
            {knownSymbols.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>

        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          side
          <select value={orderSide} onChange={(e) => setOrderSide(e.target.value)} style={styles.input}>
            <option value="Buy">Buy</option>
            <option value="Sell">Sell</option>
          </select>
        </label>

        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          type
          <select value={orderType} onChange={(e) => setOrderType(e.target.value)} style={styles.input}>
            <option value="Limit">Limit</option>
            <option value="Market">Market</option>
          </select>
        </label>

        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          qty
          <input value={orderQty} onChange={(e) => setOrderQty(e.target.value)} style={{ ...styles.input, width: 110 }} />
        </label>

        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          price
          <input value={orderPrice} onChange={(e) => setOrderPrice(e.target.value)} style={{ ...styles.input, width: 120 }} disabled={orderType === "Market"} />
        </label>

        <button style={styles.btnPrimary} onClick={onPlaceOrder} disabled={status !== "connected"}>
          placeOrder
        </button>

        <div style={{ marginLeft: "auto", fontSize: 13, opacity: 0.85 }}>
          trading enabled: <b>{risk?.enableTrading ? "yes" : "no"}</b> / halted: <b>{risk?.haltTrading ? "yes" : "no"}</b>
        </div>
      </div>
    </div>
  );
}
