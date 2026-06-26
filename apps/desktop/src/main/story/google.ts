import { getProvider, parseJson } from "../db";
import { readProviderSecret } from "../providers";

export interface GoogleImageOptions {
  aspectRatio: string;
  model?: string;
  backend?: "imagen" | "gemini";
}

export async function generateGoogleImage(prompt: string, options: GoogleImageOptions): Promise<Buffer> {
  const provider = getProvider("google");
  if (!provider) throw new Error("Google image provider not found");
  const key = readProviderSecret("google");
  if (!key) throw new Error("Google image provider has no saved API key. Add one in Providers and Save.");
  const config = parseJson<Record<string, unknown>>(provider.config_json, {});
  const backend = options.backend || String(config.imageBackend || "imagen") as "imagen" | "gemini";
  const model = options.model || String(config.imageModel || (backend === "imagen" ? "imagen-4.0-fast-generate-001" : "gemini-2.5-flash-image"));
  return backend === "gemini"
    ? generateGeminiImage(prompt, key, model)
    : generateImagenImage(prompt, key, model, options.aspectRatio);
}

async function generateImagenImage(prompt: string, key: string, model: string, aspectRatio: string): Promise<Buffer> {
  const response = await postGoogleJson(`https://generativelanguage.googleapis.com/v1beta/models/${model}:predict`, key, {
    instances: [{ prompt }],
    parameters: {
      sampleCount: 1,
      aspectRatio,
      outputMimeType: "image/png",
      personGeneration: "allow_adult",
    },
  });
  const predictions = response.predictions as Array<{ bytesBase64Encoded?: string; image?: { bytesBase64Encoded?: string } }> | undefined;
  const b64 = predictions?.[0]?.bytesBase64Encoded || predictions?.[0]?.image?.bytesBase64Encoded;
  if (!b64) throw new Error(`No image bytes in Imagen response: ${JSON.stringify(response).slice(0, 500)}`);
  return Buffer.from(b64, "base64");
}

async function generateGeminiImage(prompt: string, key: string, model: string): Promise<Buffer> {
  const response = await postGoogleJson(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, key, {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
  });
  const candidates = response.candidates as Array<{ content?: { parts?: Array<{ inlineData?: { data?: string }; inline_data?: { data?: string } }> } }> | undefined;
  for (const candidate of candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      const inline = part.inlineData || part.inline_data;
      if (inline?.data) return Buffer.from(inline.data, "base64");
    }
  }
  throw new Error(`No inline image data in Gemini response: ${JSON.stringify(response).slice(0, 500)}`);
}

async function postGoogleJson(url: string, key: string, payload: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-goog-api-key": key,
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Google image API failed (${response.status}): ${detail.slice(0, 1000) || response.statusText}`);
  }
  return response.json() as Promise<Record<string, unknown>>;
}
