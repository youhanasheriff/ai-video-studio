import { describe, expect, it } from "vitest";
import type { StockVideo } from "../shared/types";
import { pickBestFile } from "./stock";

describe("stock helpers", () => {
  it("picks the closest file that covers the target", () => {
    const video: StockVideo = {
      id: "1",
      provider: "pexels",
      width: 1920,
      height: 1080,
      duration: 10,
      url: "",
      previewUrl: null,
      files: [
        { id: "small", quality: "sd", fileType: "video/mp4", width: 640, height: 360, link: "small.mp4" },
        { id: "portrait", quality: "hd", fileType: "video/mp4", width: 1080, height: 1920, link: "portrait.mp4" },
        { id: "huge", quality: "uhd", fileType: "video/mp4", width: 2160, height: 3840, link: "huge.mp4" },
      ],
    };
    expect(pickBestFile(video, 1080, 1920)?.id).toBe("portrait");
  });
});
