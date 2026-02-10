import { styles } from "../../../shared/ui/styles";
import { fmtNum } from "../../../shared/utils/format";

export function PricesCard({ prices }) {
  const rows = Object.entries(prices || {});
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontWeight: 900, marginBottom: 8 }}>Prices (last)</div>
      <div style={styles.tableWrap}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead style={styles.thead}>
            <tr>
              <th style={styles.th}>Symbol</th>
              <th style={styles.th}>Mid</th>
              <th style={styles.th}>Time</th>
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
                  <td style={styles.td}>{fmtNum(p?.mid, 6)}</td>
                  <td style={styles.td}>{p?.ts ? new Date(p.ts).toLocaleTimeString() : "-"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
