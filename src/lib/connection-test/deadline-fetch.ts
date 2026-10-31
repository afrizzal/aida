// A fetch with a hard deadline, for the Ollama connection probes (c-WR-03). The ollama client has
// no timeout option of its own, so without this a host that accepts the TCP connection and never
// answers held the Settings action until undici's 300 s headers timeout. The deadline covers the
// whole request, body included, and is combined with any signal the client passes. On expiry
// fetch rejects with a `TimeoutError`, which classifies as connection_failed.
// No imports: bundleable by both webpack and esbuild.

export function fetchWithDeadline(timeoutMs: number): typeof fetch {
  return (input, init) => {
    const deadline = AbortSignal.timeout(timeoutMs);
    const signal = init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
    return fetch(input, { ...init, signal });
  };
}
