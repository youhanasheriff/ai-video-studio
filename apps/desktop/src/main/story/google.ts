import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { getProvider, parseJson } from "../db";
import { readProviderSecret } from "../providers";

export interface GoogleImageOptions {
  aspectRatio: string;
  model?: string;
  referenceImagePaths?: string[];
}

export async function generateGoogleImage(prompt: string, options: GoogleImageOptions): Promise<Buffer> {
  const provider = getProvider("google");
  if (!provider) throw new Error("Google image provider not found");
  const key = readProviderSecret("google");
  if (!key) throw new Error("Google image provider has no saved API key. Add one in Providers and Save.");
  const config = parseJson<Record<string, unknown>>(provider.config_json, {});
  const configuredModel = options.model || String(config.imageModel || "");
  const model = resolveGeminiImageModel(configuredModel);
  return generateGeminiImage(withAspectRatio(prompt, options.aspectRatio), key, model, options.referenceImagePaths ?? []);
}

function resolveGeminiImageModel(configuredModel: string): string {
  return configuredModel.includes("gemini") ? configuredModel : "gemini-2.5-flash-image";
}

function withAspectRatio(prompt: string, aspectRatio: string): string {
  return `${prompt}\n\nCanvas aspect ratio: ${aspectRatio}.`;
}

async function generateGeminiImage(prompt: string, key: string, model: string, referenceImagePaths: string[]): Promise<Buffer> {
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
    { text: prompt },
    ...referenceImagePaths.map((path) => ({
      inlineData: {
        mimeType: mimeTypeForPath(path),
        data: readFileSync(path).toString("base64"),
      },
    })),
  ];
  const response = await postGoogleJson(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, key, {
    contents: [{ parts }],
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

function mimeTypeForPath(path: string): string {
  const ext = extname(path).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "image/png";
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
