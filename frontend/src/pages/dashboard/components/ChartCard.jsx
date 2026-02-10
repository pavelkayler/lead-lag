import { styles } from "../../../shared/ui/styles";
import { fmtNum } from "../../../shared/utils/format";

export function ChartCard({ selectedSymbol, chartBars, onSelectSymbol, symbols }) {
  const bars = Array.isArray(chartBars) ? chartBars : [];
  const mids = bars.map((b) => b.mid).filter((x) => typeof x === "number" && Number.isFinite(x));
  const min = mids.length ? Math.min(...mids) : 0;
  const max = mids.length ? Math.max(...mids) : 0;
  const w = 900;
  const h = 160;
  const pad = 10;

  const pts = mids.map((v, i) => {
    const x = pad + (i / Math.max(1, mids.length - 1)) * (w - pad * 2);
    const y = max === min ? h / 2 : pad + (1 - (v - min) / (max - min)) * (h - pad * 2);
    return `${x},${y}`;
  }).join(" ");

  return (
    <div style={{ marginTop: 12, ...styles.card }}>
      <div style={{ fontWeight: 900, marginBottom: 8 }}>Chart</div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          symbol
          <select value={selectedSymbol} onChange={(e) => onSelectSymbol(e.target.value)} style={styles.input}>
            {symbols.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <div style={{ fontSize: 13, opacity: 0.8 }}>
          bars: <b>{bars.length}</b> / min: <b>{fmtNum(min, 2)}</b> / max: <b>{fmtNum(max, 2)}</b>
        </div>
      </div>

      <div style={{ marginTop: 10, width: "100%", overflowX: "auto" }}>
        <svg width={w} height={h} style={{ display: "block", background: "#fff", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 10 }}>
          <polyline fill="none" stroke="#111827" strokeWidth="2" points={pts} />
        </svg>
      </div>
    </div>
  );
}
