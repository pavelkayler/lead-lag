import { useEffect, useRef } from "react";

export function useInterval(callback, delayMs) {
  const cbRef = useRef(callback);
  cbRef.current = callback;

  useEffect(() => {
    if (delayMs == null) return;
    const id = setInterval(() => cbRef.current?.(), delayMs);
    return () => clearInterval(id);
  }, [delayMs]);
}
