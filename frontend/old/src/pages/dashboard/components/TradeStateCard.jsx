import { styles } from "../../../shared/ui/styles";

function JsonBox({ value }) {
  return (
    <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 12, whiteSpace: "pre-wrap", background: "#0b1220", color: "#e5e7eb", padding: 10, borderRadius: 10, minHeight: 120, overflow: "auto" }}>
      {value ? JSON.stringify(value, null, 2) : "-"}
    </div>
  );
}

export function TradeStateCard({ tradeState }) {
  return (
    <div style={{ marginTop: 12, ...styles.card }}>
      <div style={{ fontWeight: 900, marginBottom: 6 }}>Trade state (server)</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Wallet</div>
          <JsonBox value={tradeState?.wallet} />
        </div>
        <div>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Positions</div>
          <JsonBox value={tradeState?.positions} />
        </div>
        <div>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Open orders</div>
          <JsonBox value={tradeState?.openOrders} />
        </div>
        <div>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Executions</div>
          <JsonBox value={tradeState?.executions} />
        </div>
      </div>
    </div>
  );
}
