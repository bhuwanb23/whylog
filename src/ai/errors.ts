/**
 * Engine errors.
 *
 * Phase 0 · sub-phase 0.9
 *
 * Every failure an engine can have is named here, because the UI's response
 * differs per failure and "something went wrong" is not a response:
 *
 *   no-key            -> show the key field, keep the local engine running
 *   rate-limited      -> back off, say when to retry
 *   network           -> offer the local engine, do not retry silently
 *   malformed-output  -> the model returned prose where JSON was asked for;
 *                        retry once with a stricter prompt, then fall back
 *   unsupported       -> this engine cannot do this at all (rerank, locally);
 *                        NEVER retried, and the capability flag should have
 *                        prevented the call
 *   cancelled         -> the user stopped it; not an error, and not reported as one
 *
 * The distinction between `unsupported` and everything else is load-bearing:
 * `unsupported` is a permanent property of the engine, so it must be surfaced by
 * `capabilities()` BEFORE the call, not discovered by catching afterwards.
 */

export type EngineErrorCode =
  | "no-key"
  | "rate-limited"
  | "network"
  | "timeout"
  | "malformed-output"
  | "context-too-long"
  | "unsupported"
  | "provider-error"
  | "cancelled";

export class EngineError extends Error {
  readonly code: EngineErrorCode;
  /** Which engine failed. Stored on the error because the fallback path needs to
   *  say "the LLM path failed, this is the local result" rather than implying the
   *  local engine produced something it did not. */
  readonly engine: string;
  /** Provider status code, when there was one. */
  readonly status?: number;
  /** When a rate limit says so. */
  readonly retryAfterMs?: number;
  /** The raw text that failed to parse, for `malformed-output`. Kept because
   *  debugging a JSON-mode failure without the offending output is guesswork. */
  readonly raw?: string;

  constructor(
    code: EngineErrorCode,
    message: string,
    options: {
      engine?: string;
      status?: number;
      retryAfterMs?: number;
      raw?: string;
      cause?: unknown;
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "EngineError";
    this.code = code;
    this.engine = options.engine ?? "unknown";
    if (options.status !== undefined) this.status = options.status;
    if (options.retryAfterMs !== undefined) this.retryAfterMs = options.retryAfterMs;
    if (options.raw !== undefined) this.raw = options.raw;
  }
}

export function isEngineError(value: unknown): value is EngineError {
  return value instanceof EngineError;
}

/** Is this failure worth retrying, and how many times? */
export function retryPolicy(error: EngineError): {
  retry: boolean;
  attempts: number;
  delayMs: number;
} {
  switch (error.code) {
    case "rate-limited":
      return { retry: true, attempts: 2, delayMs: error.retryAfterMs ?? 2000 };
    case "timeout":
      return { retry: true, attempts: 1, delayMs: 500 };
    case "network":
      return { retry: true, attempts: 1, delayMs: 1000 };
    case "malformed-output":
      // One retry with a stricter prompt. A model that cannot produce JSON twice
      // is not going to produce it a third time.
      return { retry: true, attempts: 1, delayMs: 0 };
    case "no-key":
    case "unsupported":
    case "cancelled":
    case "context-too-long":
    case "provider-error":
      return { retry: false, attempts: 0, delayMs: 0 };
    default:
      return { retry: false, attempts: 0, delayMs: 0 };
  }
}

/** The sentence shown to the user. Written so it says what to DO. */
export function describeError(error: EngineError): string {
  switch (error.code) {
    case "no-key":
      return "No API key is configured. WhyLog is running the local engine, which needs none. Add a key in Settings to enable the LLM path.";
    case "rate-limited": {
      const seconds = Math.ceil((error.retryAfterMs ?? 2000) / 1000);
      return `The provider is rate-limiting this key. Retry in about ${seconds}s, or switch to the local engine.`;
    }
    case "network":
      return "The provider could not be reached. Nothing was sent and nothing was lost — the transcript is still in the input box.";
    case "timeout":
      return "The provider did not respond in time. The local engine can do this pass instead, at lower recall.";
    case "malformed-output":
      return "The model returned something that was not the requested JSON. The output was discarded rather than guessed at.";
    case "context-too-long":
      return "The transcript is longer than the model's context. It will be chunked on turn boundaries and processed in pieces.";
    case "unsupported":
      return "The active engine cannot do this. The capability is reported in Settings so this button should have been disabled.";
    case "cancelled":
      return "Cancelled.";
    case "provider-error":
      return `The provider returned an error${error.status === undefined ? "" : ` (${error.status})`}.`;
    default:
      return error.message;
  }
}

/** Classify a fetch failure. One place, so the three provider adapters cannot
 *  disagree about whether a 429 is retryable. */
export function fromResponse(status: number, body: string, engine: string): EngineError {
  if (status === 401 || status === 403) {
    return new EngineError("no-key", `The provider rejected the key (${status}).`, {
      engine,
      status,
    });
  }
  if (status === 429) {
    const retryAfter = parseRetryAfter(body);
    return new EngineError("rate-limited", "The provider is rate-limiting this key.", {
      engine,
      status,
      ...(retryAfter === null ? {} : { retryAfterMs: retryAfter }),
    });
  }
  if (status === 408 || status === 504) {
    return new EngineError("timeout", `The provider timed out (${status}).`, { engine, status });
  }
  if (status === 413) {
    return new EngineError("context-too-long", `The request was too large (${status}).`, {
      engine,
      status,
    });
  }
  if (status >= 500) {
    return new EngineError("provider-error", `The provider failed (${status}).`, {
      engine,
      status,
      raw: body.slice(0, 500),
    });
  }
  return new EngineError("provider-error", `The provider returned ${status}.`, {
    engine,
    status,
    raw: body.slice(0, 500),
  });
}

function parseRetryAfter(body: string): number | null {
  const match = /retry[-_ ]?after["']?\s*[:=]\s*(\d+)/i.exec(body);
  return match?.[1] ? Number(match[1]) * 1000 : null;
}

export function networkError(cause: unknown, engine: string): EngineError {
  return new EngineError("network", "The provider could not be reached.", { engine, cause });
}

export function cancelledError(engine: string): EngineError {
  return new EngineError("cancelled", "Cancelled.", { engine });
}

export function unsupportedError(capability: string, engine: string): EngineError {
  return new EngineError(
    "unsupported",
    `${engine} does not implement ${capability}. This should have been prevented by capabilities().`,
    { engine },
  );
}

export function malformedOutputError(raw: string, engine: string, cause?: unknown): EngineError {
  return new EngineError("malformed-output", "The engine's output was not the requested JSON.", {
    engine,
    raw: raw.slice(0, 2000),
    cause,
  });
}
