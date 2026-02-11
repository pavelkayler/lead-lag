import { styles } from "../../../shared/ui/styles";
import { fmtMs, fmtNum } from "../../../shared/utils/format";

export function LeadLagCard({ leadLag, note }) {
  const rows = Array.isArray(leadLag) ? leadLag : [];
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontWeight: 900, marginBottom: 8 }}>Lead–Lag Top</div>
      <div style={styles.tableWrap}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead style={styles.thead}>
            <tr>
              <th style={styles.th}>Leader</th>
              <th style={styles.th}>Follower</th>
              <th style={styles.th}>corr</th>
              <th style={styles.th}>lag</th>
              <th style={styles.th}>impulses</th>
              <th style={styles.th}>mean follower r @ lag</th>
              <th style={styles.th}>samples</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td style={styles.td} colSpan={7}>{note || "No leadlag yet: subscribe leadlag + startFeed and wait ~30–60s"}</td>
              </tr>
            ) : (
              rows.slice(0, 10).map((p, idx) => (
                <tr key={idx} style={styles.tr}>
                  <td style={{ ...styles.td, fontWeight: 800 }}>{p.leader}</td>
                  <td style={{ ...styles.td, fontWeight: 800 }}>{p.follower}</td>
                  <td style={styles.td}>{fmtNum(p.corr, 3)}</td>
                  <td style={styles.td}>{fmtMs(p.lagMs)}</td>
                  <td style={styles.td}>{p.impulses ?? "-"}</td>
                  <td style={styles.td}>{fmtNum(p.followerMeanAfterImpulse, 6)}</td>
                  <td style={styles.td}>{p.samples ?? "-"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
