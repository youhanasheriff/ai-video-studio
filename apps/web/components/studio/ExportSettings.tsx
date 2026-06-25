"use client";

import React from "react";
import { Monitor, Smartphone, Square, Image, Check } from "lucide-react";
import { Label } from "@/components/ui/label";
import { ASPECT_RATIOS } from "@/lib/types";

interface ExportSettingsProps {
  aspectRatio: string;
  onAspectRatioChange: (ratio: string) => void;
}

export function ExportSettings({ aspectRatio, onAspectRatioChange }: ExportSettingsProps) {
  const getIcon = (id: string) => {
    switch (id) {
      case "9:16":
        return Smartphone;
      case "16:9":
        return Monitor;
      case "1:1":
        return Square;
      default:
        return Image;
    }
  };

  return (
    <div className="space-y-6">
      {/* Aspect Ratio */}
      <div className="space-y-3">
        <Label className="text-sm font-medium">Video Format</Label>
        <div className="grid grid-cols-2 gap-3">
          {ASPECT_RATIOS.map((ratio) => {
            const Icon = getIcon(ratio.id);
            const isSelected = aspectRatio === ratio.id;

            return (
              <button
                key={ratio.id}
                onClick={() => onAspectRatioChange(ratio.id)}
                className={`relative p-4 rounded-xl border-2 transition-all text-left ${
                  isSelected
                    ? "border-indigo-500 bg-indigo-50"
                    : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <div className="flex items-start gap-3">
                  {/* Aspect ratio visual */}
                  <div
                    className={`flex-shrink-0 rounded-lg border-2 flex items-center justify-center ${
                      isSelected ? "border-indigo-400 bg-indigo-100" : "border-gray-300 bg-gray-100"
                    }`}
                    style={{
                      width: ratio.id === "16:9" ? 48 : ratio.id === "1:1" ? 36 : 28,
                      height: ratio.id === "9:16" ? 48 : ratio.id === "4:5" ? 44 : 36,
                    }}
                  >
                    <Icon size={16} className={isSelected ? "text-indigo-500" : "text-gray-400"} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-800">{ratio.name}</p>
                    <p className="text-xs text-gray-500">{ratio.description}</p>
                    <p className="text-xs text-gray-400 mt-1">
                      {ratio.width}×{ratio.height}
                    </p>
                  </div>
                </div>

                {isSelected && (
                  <div className="absolute top-2 right-2 w-5 h-5 bg-indigo-500 rounded-full flex items-center justify-center">
                    <Check size={12} className="text-white" />
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Quality Info */}
      <div className="p-4 bg-gray-50 rounded-xl space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-600">Output Quality</span>
          <span className="text-sm font-medium text-gray-800">HD (1080p)</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-600">Frame Rate</span>
          <span className="text-sm font-medium text-gray-800">30 FPS</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-600">Format</span>
          <span className="text-sm font-medium text-gray-800">MP4 (H.264)</span>
        </div>
      </div>

      {/* Platform recommendations */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">Best for</Label>
        <div className="flex flex-wrap gap-2">
          {aspectRatio === "9:16" && (
            <>
              <span className="px-3 py-1 bg-pink-100 text-pink-700 rounded-full text-xs font-medium">TikTok</span>
              <span className="px-3 py-1 bg-gradient-to-r from-purple-100 to-pink-100 text-purple-700 rounded-full text-xs font-medium">Instagram Reels</span>
              <span className="px-3 py-1 bg-red-100 text-red-700 rounded-full text-xs font-medium">YouTube Shorts</span>
            </>
          )}
          {aspectRatio === "16:9" && (
            <>
              <span className="px-3 py-1 bg-red-100 text-red-700 rounded-full text-xs font-medium">YouTube</span>
              <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">LinkedIn</span>
              <span className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-xs font-medium">Website</span>
            </>
          )}
          {aspectRatio === "1:1" && (
            <>
              <span className="px-3 py-1 bg-gradient-to-r from-purple-100 to-pink-100 text-purple-700 rounded-full text-xs font-medium">Instagram Feed</span>
              <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">Facebook</span>
              <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">Twitter</span>
            </>
          )}
          {aspectRatio === "4:5" && (
            <>
              <span className="px-3 py-1 bg-gradient-to-r from-purple-100 to-pink-100 text-purple-700 rounded-full text-xs font-medium">Instagram Feed</span>
              <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">Facebook Feed</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
