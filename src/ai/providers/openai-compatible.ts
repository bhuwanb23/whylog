/**
 * One HTTP client for every provider.
 *
 * Phase 1 · sub-phase 1.10 (the LLM path)
 */

import type { ProviderId } from "../config";
import {
  EngineError,
  fromResponse,
  malformedOutputError,
  networkError,
  retryPolicy,
} from "../errors";

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
 * Sanitize user-provided text before sending it to an LLM.
 * Strips control characters and bounds length to 100k chars.
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
  max: number = 50,
): readonly ChatMessage[] {
  if (messages.length <= max) return messages;
  const split = Math.ceil(max / 2);
  return messages.slice(0, split).concat(messages.slice(-split));
}

/**
 * Add a system prompt if not already present, after validating it.
 * Rejects system prompts containing dangerous instruction patterns.
 */
export function addSystemPrompt(
  messages: readonly ChatMessage[],
  systemContent: string,
): ChatMessage[] {
  const dangerousPatterns = [
    /ignore\s+(previous|all|above|below|system|instructions|rules)/i,
    /forget\s+(everything|all|previous|instructions)/i,
    /disregard\s+(instructions|rules|constraints|previous)/i,
    /act\s+as\s+(if\s+you\s+are|though\s+you)/i,
    /new\s+instructions/i,
    /do\s+not\s+(mention|reference|reveal|disclose)/i,
    /system\s+prompt\s+(reveal|show|display|output)/i,
  ];
  if (dangerousPatterns.some((pattern) => pattern.test(systemContent))) {
    throw new Error("System prompt contains suspicious patterns");
  }
  const hasSystem = messages.some((msg) => msg.role === "system");
  if (hasSystem) return messages as ChatMessage[];
  return [{ role: "system", content: systemContent }, ...messages] as ChatMessage[];
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
