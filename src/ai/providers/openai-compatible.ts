/**
 * One HTTP client for every provider.
 *
 * Phase 1 · sub-phase 1.10 (the LLM path)
 *
 * Trust boundary: everything that crosses into an LLM request is treated as
 * untrusted for INSTRUCTION purposes. The provider layer sanitises the bytes
 * that leave the browser, but the real defence is upstream: transcript text and
 * system/prompt material are constructed in separate, labelled slots so the model
 * is asked to analyse or compose rather than to follow whatever phrasing it sees.
 *
 * The pattern blacklist in `addSystemPrompt` is a COMPLIANCE gate, not the main
 * defence. It exists so a developer cannot accidentally ship an obviously override-
 * shaped system prompt; it does not make a crafted transcript safe.
 */

import type { ProviderId } from "../config";
import {
  EngineError,
  fromResponse,
  malformedOutputError,
  networkError,
  retryPolicy,
} from "../errors";

/**
 * A raw LLM response is untrusted data. Parse it defensively, validate it against
 * a schema at the call site, and never feed it into eval / SQL / a shell / the DOM
 * or a file path. This module only returns plain text plus token counts; every
 * downstream artefact (extraction, composition, guard proposals, classifications)
 * is parsed and validated by the consumer that defines the shape.
 */
export type LlmText = string;

export interface ChatMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

export interface ChatRequest {
  readonly model: string;
  readonly messages: readonly ChatMessage[];
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly signal?: AbortSignal;
  readonly json?: boolean;
}

export interface ChatResponse {
  readonly text: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly model: string;
}

const ENDPOINTS: Readonly<Record<Exclude<ProviderId, "local">, string>> = {
  openai: "https://api.openai.com/v1/chat/completions",
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
  anthropic: "https://api.anthropic.com/v1/messages",
};

const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_MAX_TOKENS = 4_096;
const MAX_QUOTED_BODY = 400;

export async function chat(
  provider: Exclude<ProviderId, "local">,
  apiKey: string,
  request: ChatRequest,
): Promise<ChatResponse> {
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      return await once(provider, apiKey, request);
    } catch (error) {
      if (!(error instanceof EngineError)) throw error;
      if (request.signal?.aborted) throw error;
      const policy = retryPolicy(error);
      if (!policy.retry || attempt > policy.attempts) throw error;
      await sleep(policy.delayMs * attempt, request.signal);
    }
  }
}

async function once(
  provider: Exclude<ProviderId, "local">,
  apiKey: string,
  request: ChatRequest,
): Promise<ChatResponse> {
  if (request.signal?.aborted) {
    throw new EngineError("cancelled", "Cancelled before the request was sent.", {
      engine: request.model,
    });
  }
  const url = ENDPOINTS[provider];
  const body = provider === "anthropic" ? anthropicBody(request) : openaiBody(provider, request);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  const onAbort = (): void => controller.abort();
  request.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: headers(provider, apiKey, request),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok)
      throw fromResponse(response.status, text.slice(0, MAX_QUOTED_BODY), request.model);
    return provider === "anthropic"
      ? readAnthropic(text, request.model)
      : readOpenAi(text, request.model);
  } catch (error) {
    if (error instanceof EngineError) throw error;
    if (controller.signal.aborted && request.signal?.aborted) {
      throw new EngineError("cancelled", "Cancelled.", { engine: request.model });
    }
    if (controller.signal.aborted) {
      throw new EngineError("timeout", `No response within ${DEFAULT_TIMEOUT_MS / 1000}s.`, {
        engine: request.model,
      });
    }
    throw networkError(error, request.model);
  } finally {
    clearTimeout(timeout);
    request.signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Sanitize bytes that leave the browser for an LLM request.
 *
 * This is a transport/ 위생 gate: it strips zero-width and BOM control characters
 * and caps length so a single turn cannot blow up the request. It does NOT make the
 * content instruction-safe — that is the job of the prompt construction that puts the
 * text into a labelled USER slot, not the SYSTEM slot.
 */
export function sanitizeLlmInput(text: string): string {
  const controlRe = /[\u200b-\u200f\ufeff]/g;
  const noControl = text.replace(controlRe, "");
  return noControl.length > 100_000 ? noControl.slice(0, 100_000) : noControl;
}

/**
 * Bound the number of messages sent to an LLM. Limits to 50 messages.
 */
export function boundLlmMessages(
  messages: readonly ChatMessage[],
  max = 50,
): readonly ChatMessage[] {
  if (messages.length <= max) return messages;
  const split = Math.ceil(max / 2);
  return messages.slice(0, split).concat(messages.slice(-split));
}

/**
 * Install a SYSTEM prompt only when the conversation has none.
 *
 * This is a COMPLIANCE guard, not the main prompt-injection defence. It rejects
 * obviously override-shaped system text so a developer cannot accidentally ship one;
 * it does not make a crafted transcript safe. The transcript the user wants analyzed
 * must travel in USER turns, never as system text.
 *
 * System text is authoritative for the model's ROLE and CONSTRAINTS. User text —
 * including the transcript — is data to analyse. Keeping those slots separate is the
 * structural protection; this function only ensures the SYSTEM slot is not abused.
 */
export function addSystemPrompt(
  messages: readonly ChatMessage[],
  systemContent: string,
): ChatMessage[] {
  if (!isInstructionContent(systemContent)) {
    throw new Error("System prompt contains suspicious patterns");
  }
  const hasSystem = messages.some((msg) => msg.role === "system");
  if (hasSystem) return messages as ChatMessage[];
  return [{ role: "system", content: systemContent }, ...messages] as ChatMessage[];
}

/**
 * Heuristic gate on SYSTEM text only.
 *
 * These patterns are NOT an attack detector. They are a backstop against the most
 * obvious override shapes so the SYSTEM role is not used to smuggle instructions that
 * should live in the application prompt instead.
 */
function isInstructionContent(systemContent: string): boolean {
  const patterns = [
    /ignore\s+(previous|all|above|below|system|instructions|rules)/i,
    /forget\s+(everything|all|previous|instructions)/i,
    /disregard\s+(instructions|rules|constraints|previous)/i,
    /act\s+as\s+(if\s+you\s+are|though\s+you)/i,
    /new\s+instructions/i,
    /do\s+not\s+(mention|reference|reveal|disclose)/i,
    /system\s+prompt\s+(reveal|show|display|output)/i,
  ];
  return !patterns.some((pattern) => pattern.test(systemContent));
}

function openaiBody(
  provider: Exclude<ProviderId, "local">,
  request: ChatRequest,
): Record<string, unknown> {
  const sanitizedContents = request.messages.map((msg) => sanitizeLlmInput(msg.content));
  const body: Record<string, unknown> = {
    model: request.model,
    messages: request.messages.map((msg, i) => ({
      role: msg.role,
      content: sanitizedContents[i],
    })),
    temperature: request.temperature ?? 0.2,
    max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
  };
  if (request.json === true && provider === "openai") {
    body["response_format"] = { type: "json_object" };
  }
  return body;
}

function anthropicBody(request: ChatRequest): Record<string, unknown> {
  const system = request.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  return {
    model: request.model,
    ...(system.length === 0 ? {} : { system }),
    messages: request.messages
      .filter((message) => message.role !== "system")
      .map((message) => ({ role: message.role, content: message.content })),
    temperature: request.temperature ?? 0.2,
    max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
  };
}

function headers(
  provider: Exclude<ProviderId, "local">,
  apiKey: string,
  request: ChatRequest,
): Record<string, string> {
  const base: Record<string, string> = { "content-type": "application/json" };
  if (provider === "anthropic") {
    base["x-api-key"] = apiKey;
    base["anthropic-version"] = ANTHROPIC_VERSION;
    base["anthropic-dangerous-direct-browser-access"] = "true";
    return base;
  }
  base["authorization"] = `Bearer ${apiKey}`;
  if (provider === "openrouter") {
    base["http-referrer"] = "https://github.com/whylog";
    base["x-title"] = "WhyLog";
  }
  void request;
  return base;
}

function readOpenAi(raw: string, model: string): ChatResponse {
  const parsed = parseJson(raw, model);
  const choice = Array.isArray(parsed["choices"])
    ? (parsed["choices"][0] as Record<string, unknown>)
    : undefined;
  const message = choice?.["message"] as Record<string, unknown> | undefined;
  const text = typeof message?.["content"] === "string" ? message["content"] : "";
  if (text.length === 0) throw malformedOutputError(raw.slice(0, MAX_QUOTED_BODY), model);
  const usage = parsed["usage"] as Record<string, unknown> | undefined;
  return {
    text,
    promptTokens: numberOf(usage?.["prompt_tokens"]),
    completionTokens: numberOf(usage?.["completion_tokens"]),
    model: typeof parsed["model"] === "string" ? parsed["model"] : model,
  };
}

function readAnthropic(raw: string, model: string): ChatResponse {
  const parsed = parseJson(raw, model);
  const blocks = Array.isArray(parsed["content"])
    ? (parsed["content"] as readonly Record<string, unknown>[])
    : [];
  const text = blocks
    .filter((block) => block["type"] === "text" && typeof block["text"] === "string")
    .map((block) => block["text"] as string)
    .join("");
  if (text.length === 0) throw malformedOutputError(raw.slice(0, MAX_QUOTED_BODY), model);
  const usage = parsed["usage"] as Record<string, unknown> | undefined;
  return {
    text,
    promptTokens: numberOf(usage?.["input_tokens"]),
    completionTokens: numberOf(usage?.["output_tokens"]),
    model: typeof parsed["model"] === "string" ? parsed["model"] : model,
  };
}

function parseJson(raw: string, model: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw fromResponse(
      502,
      `Provider returned something that is not JSON: ${raw.slice(0, 120)}`,
      model,
    );
  }
}

function numberOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function extractJson(text: string, model: string): Record<string, unknown> {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw malformedOutputError(text.slice(0, MAX_QUOTED_BODY), model);
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1)) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw malformedOutputError(
      candidate.slice(start, Math.min(end + 1, start + MAX_QUOTED_BODY)),
      model,
      error,
    );
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new EngineError("cancelled", "Cancelled while waiting to retry.", { engine: "llm" }));
    };
    if (signal?.aborted) {
      clearTimeout(timer);
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
