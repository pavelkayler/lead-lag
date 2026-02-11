export function nextFsmState(current, signal) {
  const table = {
    IDLE: signal === "candidate" ? "CANDIDATE" : "IDLE",
    CANDIDATE: signal === "setup" ? "SETUP_FOUND" : (signal === "drop" ? "IDLE" : "CANDIDATE"),
    SETUP_FOUND: signal === "trigger" ? "TRIGGER_WAIT" : (signal === "drop" ? "ABORTED" : "SETUP_FOUND"),
    TRIGGER_WAIT: signal === "enter" ? "ENTERING" : (signal === "ttl" ? "ABORTED" : "TRIGGER_WAIT"),
    ENTERING: signal === "filled" ? "MANAGING" : (signal === "fail" ? "ABORTED" : "ENTERING"),
    MANAGING: signal === "close" ? "CLOSED" : "MANAGING",
  };
  return table[current] || current;
}
