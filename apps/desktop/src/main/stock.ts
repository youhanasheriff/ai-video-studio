import { createWriteStream, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Asset, ShortGenerationRequest, StockVideo, StockVideoFile } from "../shared/types";
import { type AssetRow, execSql, getProvider, id, mapAsset, now, querySql, sql } from "./db";
import { projectDir } from "./paths";
import { readProviderSecret } from "./providers";

export async function searchStockVideos(providerId: "pexels" | "pixabay", query: string, perPage = 8): Promise<StockVideo[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  if (providerId === "pexels") return searchPexels(trimmed, perPage);
  return searchPixabay(trimmed, perPage);
}

export async function searchPexels(query: string, perPage = 8): Promise<StockVideo[]> {
  const key = readProviderSecret("pexels");
  if (!key) throw new Error("Pexels API key is not configured.");
  const url = new URL("https://api.pexels.com/videos/search");
  url.searchParams.set("query", query);
  url.searchParams.set("per_page", String(perPage));
  url.searchParams.set("page", "1");
  url.searchParams.set("orientation", "portrait");
  url.searchParams.set("size", "large");
  const data = await fetchJson<{ videos?: Array<Record<string, unknown>> }>(url, { Authorization: key });
  return (data.videos ?? []).map(mapPexelsVideo).filter(Boolean) as StockVideo[];
}

export async function searchPixabay(query: string, perPage = 8): Promise<StockVideo[]> {
  const key = readProviderSecret("pixabay");
  if (!key) throw new Error("Pixabay API key is not configured.");
  const url = new URL("https://pixabay.com/api/videos/");
  url.searchParams.set("key", key);
  url.searchParams.set("q", query);
  url.searchParams.set("video_type", "all");
  url.searchParams.set("per_page", String(Math.min(200, perPage)));
  url.searchParams.set("page", "1");
  url.searchParams.set("min_width", "720");
  url.searchParams.set("safesearch", "true");
  const data = await fetchJson<{ hits?: Array<Record<string, unknown>> }>(url);
  return (data.hits ?? []).map(mapPixabayVideo).filter(Boolean) as StockVideo[];
}

export function pickBestFile(video: StockVideo, targetWidth: number, targetHeight: number): StockVideoFile | null {
  const files = video.files.filter((file) => file.link && file.width > 0 && file.height > 0);
  if (!files.length) return null;
  const scored = files.map((file) => {
    const covers = file.width >= targetWidth || file.height >= targetHeight;
    const aspectDelta = Math.abs((file.width / file.height) - (targetWidth / targetHeight));
    const pixelDelta = Math.abs(file.width * file.height - targetWidth * targetHeight) / Math.max(1, targetWidth * targetHeight);
    return { file, score: (covers ? 0 : 10) + aspectDelta * 4 + pixelDelta };
  });
  scored.sort((a, b) => a.score - b.score);
  return scored[0]?.file ?? null;
}

export async function downloadStockVideo(video: StockVideo, outputPath: string, request?: Pick<ShortGenerationRequest, "aspectRatio">): Promise<string> {
  const [targetWidth, targetHeight] = sizeForAspect(request?.aspectRatio ?? "9:16");
  const file = pickBestFile(video, targetWidth, targetHeight);
  if (!file) throw new Error(`No downloadable stock file found for ${video.provider}:${video.id}`);
  try {
    const response = await fetch(file.link);
    if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}): ${response.statusText}`);
    await pipeline(Readable.fromWeb(response.body as never), createWriteStream(outputPath));
    return outputPath;
  } catch (error) {
    if (existsSync(outputPath)) rmSync(outputPath, { force: true });
    throw error;
  }
}

export async function downloadStockAsset(projectId: string, video: StockVideo, keyword = "stock", request?: Pick<ShortGenerationRequest, "aspectRatio">): Promise<Asset> {
  const assetId = id("asset");
  const target = join(projectDir(projectId), "assets", `${assetId}-${video.provider}-${video.id}.mp4`);
  await downloadStockVideo(video, target, request);
  execSql(`
    INSERT INTO assets (id, project_id, kind, source, original_path, local_path, metadata_json, created_at)
    VALUES (
      ${sql(assetId)}, ${sql(projectId)}, 'video', 'generated', ${sql(video.url)}, ${sql(target)},
      ${sql(JSON.stringify({ filename: `${video.provider}-${video.id}.mp4`, provider: video.provider, stockId: video.id, keyword, previewUrl: video.previewUrl }))},
      ${sql(now())}
    );
  `);
  return mapAsset(querySql<AssetRow>(`SELECT * FROM assets WHERE id = ${sql(assetId)} LIMIT 1;`)[0]);
}

export async function getStockClips(projectId: string, request: ShortGenerationRequest): Promise<Asset[]> {
  const providers = ["pexels", "pixabay"] as const;
  const providerId = providers.find((entry) => {
    const provider = getProvider(entry);
    return provider?.enabled && readProviderSecret(entry);
  });
  if (!providerId) throw new Error("No enabled stock provider with a saved API key.");
  const keywords = request.keywords.length ? request.keywords : deriveKeywords(request.script);
  const downloaded: Asset[] = [];
  for (const keyword of keywords.slice(0, 3)) {
    const variants = [keyword, simplifyKeyword(keyword)].filter((entry, index, list) => entry && list.indexOf(entry) === index);
    for (const variant of variants) {
      const videos = await searchStockVideos(providerId, variant, 6).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        if (/429/.test(message)) throw error;
        return [];
      });
      const candidate = videos[0];
      if (!candidate) continue;
      downloaded.push(await downloadStockAsset(projectId, candidate, variant, request));
      break;
    }
    if (downloaded.length >= 1) break;
  }
  return downloaded;
}

function mapPexelsVideo(raw: Record<string, unknown>): StockVideo | null {
  const files = Array.isArray(raw.video_files) ? raw.video_files as Array<Record<string, unknown>> : [];
  return {
    id: String(raw.id ?? ""),
    provider: "pexels",
    width: Number(raw.width) || 0,
    height: Number(raw.height) || 0,
    duration: Number(raw.duration) || 0,
    url: String(raw.url ?? ""),
    previewUrl: ((raw.video_pictures as Array<Record<string, unknown>> | undefined)?.[0]?.picture as string | undefined) ?? null,
    files: files.map((file) => ({
      id: String(file.id ?? ""),
      quality: String(file.quality ?? ""),
      fileType: String(file.file_type ?? "video/mp4"),
      width: Number(file.width) || 0,
      height: Number(file.height) || 0,
      link: String(file.link ?? ""),
    })).filter((file) => file.link),
  };
}

function mapPixabayVideo(raw: Record<string, unknown>): StockVideo | null {
  const videos = raw.videos && typeof raw.videos === "object" ? raw.videos as Record<string, Record<string, unknown>> : {};
  const files = Object.entries(videos).map(([quality, file]) => ({
    id: String(raw.id ?? quality),
    quality,
    fileType: "video/mp4",
    width: Number(file.width) || 0,
    height: Number(file.height) || 0,
    link: String(file.url ?? ""),
  })).filter((file) => file.link);
  if (!files.length) return null;
  const pictureId = String(raw.picture_id ?? "");
  return {
    id: String(raw.id ?? ""),
    provider: "pixabay",
    width: files[0]?.width ?? 0,
    height: files[0]?.height ?? 0,
    duration: Number(raw.duration) || 0,
    url: String(raw.pageURL ?? ""),
    previewUrl: pictureId ? `https://i.vimeocdn.com/video/${pictureId}_640x360.jpg` : null,
    files,
  };
}

async function fetchJson<T>(url: URL, headers: Record<string, string> = {}, attempt = 0): Promise<T> {
  const response = await fetch(url, { headers });
  if ([429, 500, 502, 503, 504].includes(response.status) && attempt < 2) {
    await new Promise((resolve) => setTimeout(resolve, 1200 * (attempt + 1)));
    return fetchJson<T>(url, headers, attempt + 1);
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Stock API failed (${response.status}): ${detail.slice(0, 500) || response.statusText}`);
  }
  return await response.json() as T;
}

function sizeForAspect(aspect: ShortGenerationRequest["aspectRatio"]): [number, number] {
  if (aspect === "16:9") return [1920, 1080];
  if (aspect === "1:1") return [1080, 1080];
  if (aspect === "4:5") return [1080, 1350];
  return [1080, 1920];
}

function simplifyKeyword(keyword: string): string {
  return keyword.split(/\s+/).slice(0, 2).join(" ");
}

function deriveKeywords(script: string): string[] {
  const stop = new Set(["the", "and", "that", "this", "with", "from", "your", "into", "video", "create"]);
  const counts = new Map<string, number>();
  for (const word of script.toLowerCase().match(/\b[a-z]{4,}\b/g) ?? []) {
    if (stop.has(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([word]) => word);
}
