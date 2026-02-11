export function Button({ variant = "default", style, ...props }) {
  const base = {
    padding: "8px 12px",
    borderRadius: 10,
    border: "1px solid rgba(0,0,0,0.12)",
    background: "#ffffff",
    color: "#111827",
    cursor: "pointer",
    fontWeight: 700,
  };
  const primary = { border: "1px solid #111827", background: "#111827", color: "#ffffff", fontWeight: 800 };
  const danger = { border: "1px solid #DC2626", background: "#FEE2E2", color: "#111827", fontWeight: 800 };
  const v = variant === "primary" ? primary : variant === "danger" ? danger : null;
  return <button style={{ ...base, ...(v || {}), ...(style || {}) }} {...props} />;
}
