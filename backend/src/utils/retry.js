export async function withRetry(fn, retries = 3, delayMs = 250) {
  let error;
  for (let i = 0; i < retries; i += 1) {
    try {
      return await fn();
    } catch (err) {
      error = err;
      await new Promise((resolve) => setTimeout(resolve, delayMs * (i + 1)));
    }
  }
  throw error;
}
