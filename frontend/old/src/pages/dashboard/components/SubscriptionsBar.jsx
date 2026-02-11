import { styles } from "../../../shared/ui/styles";

function SubBox({ label, checked, onChange }) {
  return (
    <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span style={{ fontSize: 13 }}>{label}</span>
    </label>
  );
}

export function SubscriptionsBar({ subs, onToggle }) {
  return (
    <div style={{ marginTop: 10, ...styles.card }}>
      <div style={{ fontWeight: 800, marginBottom: 8 }}>Subscriptions</div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
        {Object.keys(subs).map((k) => (
          <SubBox key={k} label={k} checked={!!subs[k]} onChange={(v) => onToggle(k, v)} />
        ))}
      </div>
    </div>
  );
}
