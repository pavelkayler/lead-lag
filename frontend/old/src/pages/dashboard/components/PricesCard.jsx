import { styles } from "../../../shared/ui/styles";
import { fmtNum } from "../../../shared/utils/format";

export function PricesCard({ prices, feedStatus }) {
  const rows = Object.entries(prices || {});
  const bn = feedStatus?.binance || null;
  const bnState = bn?.status || (bn?.wsUp ? "OK" : "DOWN");
  const bnAge = Number.isFinite(Number(bn?.lastMsgAgeMs)) ? `${Number(bn.lastMsgAgeMs)}ms` : "n/a";

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontWeight: 900 }}>Prices (last)</div>
        <div style={{ fontSize: 12, opacity: 0.8 }}>Binance WS: {bnState} • age={bnAge}{bn?.lastError ? ` • ${bn.lastError}` : ""}</div>
      </div>
      <div style={styles.tableWrap}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead style={styles.thead}>
            <tr>
              <th style={styles.th}>Symbol</th>
              <th style={styles.th}>Bybit (BT)</th>
              <th style={styles.th}>Binance (BNB)</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td style={styles.td} colSpan={3}>No prices yet (subscribe price + startFeed)</td>
              </tr>
            ) : (
              rows.map(([sym, p]) => (
                <tr key={sym} style={styles.tr}>
                  <td style={{ ...styles.td, fontWeight: 800 }}>{sym}</td>
                  <td style={styles.td}>{fmtNum(p?.BT?.mid, 6)}</td>
                  <td style={styles.td}>{p?.BNB?.mid != null ? fmtNum(p?.BNB?.mid, 6) : "нет данных BNB"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
