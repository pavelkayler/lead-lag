import { useMemo } from "react";
import { styles } from "../../../shared/ui/styles";

function Field({ label, value, onChange, width = 240 }) {
  return (
    <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <span style={{ fontSize: 13, width: 92 }}>{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} style={{ ...styles.input, width }} />
    </label>
  );
}

function Select({ label, value, options, onChange, width = 240 }) {
  return (
    <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <span style={{ fontSize: 13, width: 92 }}>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={{ ...styles.input, width }}>
        <option value="">-</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </label>
  );
}

export function RecorderCard({
  recordMsg,
  recordFile,
  setRecordFile,
  replayFile,
  setReplayFile,
  replaySpeed,
  setReplaySpeed,
  recordings,
  onRefreshList,
  onRecordStart,
  onRecordStop,
  onReplayStart,
  onReplayStop,
}) {
  const st = recordMsg || {};
  const progress = useMemo(() => {
    const total = st.total || 0;
    const idx = st.idx || 0;
    if (!total) return "-";
    const pct = Math.min(100, Math.round((idx / total) * 100));
    return `${idx}/${total} (${pct}%)`;
  }, [st.total, st.idx]);

  return (
    <div style={{ marginTop: 12, ...styles.card }}>
      <div style={{ fontWeight: 900, marginBottom: 6 }}>Record / Replay</div>

      <div style={{ fontSize: 13, display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
        <div>recording: <b>{st.recording ? "yes" : "no"}</b></div>
        <div>replaying: <b>{st.replaying ? "yes" : "no"}</b></div>
        <div>file: <b>{st.file || "-"}</b></div>
        <div>replayFile: <b>{st.replayFile || "-"}</b></div>
        <div>speed: <b>{st.speed || "-"}</b></div>
        <div>progress: <b>{progress}</b></div>
      </div>

      <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <Field label="recordFile" value={recordFile} onChange={setRecordFile} width={240} />
        <button style={styles.btn} onClick={onRecordStart}>recordStart</button>
        <button style={styles.btnAlt} onClick={onRecordStop}>recordStop</button>
      </div>

      <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <Select label="replayFile" value={replayFile} options={recordings || []} onChange={setReplayFile} width={240} />
        <Field label="speed" value={replaySpeed} onChange={setReplaySpeed} width={90} />
        <button style={styles.btn} onClick={onReplayStart}>replayStart</button>
        <button style={styles.btnAlt} onClick={onReplayStop}>replayStop</button>
        <button style={styles.btnAlt} onClick={onRefreshList}>refreshList</button>
      </div>

      <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>
        Record writes JSONL to backend/recordings. Replay injects recorded <b>price</b> ticks into feed (WS off) so you can debug paper/lead-lag deterministically.
      </div>
    </div>
  );
}
