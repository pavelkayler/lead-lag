import { styles } from "../../../shared/ui/styles";

export function LogConsoleCard({ log }) {
  const lines = Array.isArray(log) ? log : [];
  return (
    <div style={{ marginTop: 12, ...styles.card }}>
      <div style={{ fontWeight: 900, marginBottom: 6 }}>Console</div>
      <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 12, whiteSpace: "pre-wrap", background: "#0b1220", color: "#e5e7eb", padding: 10, borderRadius: 10, minHeight: 140, maxHeight: 260, overflow: "auto" }}>
        {lines.length ? lines.join("\n") : "No logs yet"}
      </div>
    </div>
  );
}
