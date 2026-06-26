import type { ProviderConfig } from "../../shared/types";
import { getProvider, parseJson } from "../db";
import { readProviderSecret } from "../providers";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionOptions {
  providerId: string;
  messages: ChatMessage[];
  model?: string;
  json?: boolean;
  temperature?: number;
}

export async function chatCompletion({ providerId, messages, model, json = false, temperature = 0.7 }: ChatCompletionOptions): Promise<string> {
  const provider = getProvider(providerId);
  if (!provider) throw new Error(`LLM provider not found: ${providerId}`);
  const config = parseJson<Record<string, unknown>>(provider.config_json, {});
  const modelName = String(model || config.modelName || config.llmModel || defaultModel(providerId)).trim();
  const baseUrl = chatBaseUrl(providerId, provider.base_url);
  const secret = readProviderSecret(providerId);
  // Usable if it has a key, or is a local runtime. The "enabled" toggle only controls
  // auto-discovery defaults — an explicitly selected, key-bearing provider should work.
  if (provider.privacy !== "local" && !secret) {
    throw new Error(`${provider.name} has no API key. Add one in Providers and Save.`);
  }
  const body: Record<string, unknown> = {
    model: modelName,
    messages,
    temperature,
  };
  if (json) body.response_format = { type: "json_object" };

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (response.status === 404 && providerId === "ollama") {
    return ollamaNativeChat(provider, messages, modelName, json);
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Chat completion failed (${response.status}): ${detail.slice(0, 1000) || response.statusText}`);
  }
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Chat completion returned no content");
  return content;
}

function chatBaseUrl(providerId: string, baseUrl: string | null): string {
  const raw = (baseUrl || (providerId === "ollama" ? "http://localhost:11434" : "https://api.openai.com/v1")).replace(/\/$/, "");
  if (providerId === "ollama" && !raw.endsWith("/v1")) return `${raw}/v1`;
  return raw;
}

function defaultModel(providerId: string): string {
  if (providerId === "ollama") return "llama3.1";
  if (providerId === "lm-studio") return "local-model";
  return "gpt-4o-mini";
}

async function ollamaNativeChat(provider: Pick<ProviderConfig, "baseUrl"> & { base_url?: string | null }, messages: ChatMessage[], model: string, json: boolean): Promise<string> {
  const raw = ((provider as { base_url?: string | null }).base_url || provider.baseUrl || "http://localhost:11434").replace(/\/v1$/, "").replace(/\/$/, "");
  const response = await fetch(`${raw}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      ...(json ? { format: "json" } : {}),
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Ollama chat failed (${response.status}): ${detail.slice(0, 1000) || response.statusText}`);
  }
  const data = await response.json() as { message?: { content?: string } };
  if (!data.message?.content) throw new Error("Ollama chat returned no content");
  return data.message.content;
}

export function extractJsonObject(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    if (fenced) return JSON.parse(fenced);
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error("Could not extract JSON from model response");
  }
}
