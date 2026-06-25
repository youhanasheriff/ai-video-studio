"use client";

import React, { useState } from "react";
import { Type, AlignVerticalJustifyStart, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd, Palette, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SUBTITLE_PRESETS, type SubtitleStyle } from "@/lib/types";

interface SubtitleEditorProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  style: SubtitleStyle;
  onStyleChange: (style: SubtitleStyle) => void;
  fontSize: number;
  onFontSizeChange: (size: number) => void;
  position: "top" | "center" | "bottom";
  onPositionChange: (position: "top" | "center" | "bottom") => void;
  animation: string;
  onAnimationChange: (animation: string) => void;
}

export function SubtitleEditor({
  enabled,
  onEnabledChange,
  style,
  onStyleChange,
  fontSize,
  onFontSizeChange,
  position,
  onPositionChange,
  animation,
  onAnimationChange,
}: SubtitleEditorProps) {
  const [showColorPicker, setShowColorPicker] = useState(false);

  const positions = [
    { id: "top", icon: AlignVerticalJustifyStart, label: "Top" },
    { id: "center", icon: AlignVerticalJustifyCenter, label: "Center" },
    { id: "bottom", icon: AlignVerticalJustifyEnd, label: "Bottom" },
  ] as const;

  const animations = [
    { id: "karaoke", label: "Karaoke", description: "Word-by-word highlight" },
    { id: "fade", label: "Fade", description: "Smooth fade in/out" },
    { id: "typewriter", label: "Typewriter", description: "Letter by letter" },
    { id: "none", label: "None", description: "Static text" },
  ];

  return (
    <div className="space-y-6">
      {/* Enable/Disable */}
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm font-medium">Subtitles</Label>
          <p className="text-xs text-gray-500">Add captions to your video</p>
        </div>
        <Switch checked={enabled} onCheckedChange={onEnabledChange} />
      </div>

      {enabled && (
        <>
          {/* Style Presets */}
          <div className="space-y-3">
            <Label className="text-sm font-medium flex items-center gap-2">
              <Palette size={14} />
              Style Preset
            </Label>
            <div className="grid grid-cols-3 gap-2">
              {SUBTITLE_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  onClick={() => onStyleChange(preset)}
                  className={`relative p-3 rounded-xl border-2 transition-all ${
                    style.name === preset.name
                      ? "border-indigo-500 bg-indigo-50"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  {/* Preview */}
                  <div
                    className="h-8 rounded-lg flex items-center justify-center text-xs font-bold mb-2"
                    style={{
                      backgroundColor: preset.backgroundColor === "transparent" ? "#1a1a1a" : preset.backgroundColor,
                      color: preset.primaryColor,
                    }}
                  >
                    <span style={{ color: preset.highlightColor }}>Hello</span>
                    <span style={{ color: preset.primaryColor }}> World</span>
                  </div>
                  <p className="text-xs font-medium text-gray-700 text-center">{preset.name}</p>
                  {style.name === preset.name && (
                    <div className="absolute -top-1 -right-1 w-5 h-5 bg-indigo-500 rounded-full flex items-center justify-center">
                      <Check size={12} className="text-white" />
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Custom Colors */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Colors</Label>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs text-gray-500 mb-1 block">Primary</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={style.primaryColor}
                    onChange={(e) => onStyleChange({ ...style, primaryColor: e.target.value })}
                    className="w-10 h-10 rounded-lg border border-gray-200 cursor-pointer"
                  />
                  <input
                    type="text"
                    value={style.primaryColor}
                    onChange={(e) => onStyleChange({ ...style, primaryColor: e.target.value })}
                    className="flex-1 px-3 py-2 text-xs border border-gray-200 rounded-lg font-mono"
                  />
                </div>
              </div>
              <div className="flex-1">
                <label className="text-xs text-gray-500 mb-1 block">Highlight</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={style.highlightColor}
                    onChange={(e) => onStyleChange({ ...style, highlightColor: e.target.value })}
                    className="w-10 h-10 rounded-lg border border-gray-200 cursor-pointer"
                  />
                  <input
                    type="text"
                    value={style.highlightColor}
                    onChange={(e) => onStyleChange({ ...style, highlightColor: e.target.value })}
                    className="flex-1 px-3 py-2 text-xs border border-gray-200 rounded-lg font-mono"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Font Size */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Font Size</Label>
              <span className="text-sm text-gray-500">{fontSize}px</span>
            </div>
            <input
              type="range"
              min={24}
              max={72}
              value={fontSize}
              onChange={(e) => onFontSizeChange(parseInt(e.target.value))}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
            />
            <div className="flex justify-between text-xs text-gray-400">
              <span>Small</span>
              <span>Large</span>
            </div>
          </div>

          {/* Position */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Position</Label>
            <div className="flex gap-2">
              {positions.map((pos) => (
                <button
                  key={pos.id}
                  onClick={() => onPositionChange(pos.id)}
                  className={`flex-1 py-3 px-4 rounded-xl border-2 transition-all flex flex-col items-center gap-1 ${
                    position === pos.id
                      ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                      : "border-gray-200 hover:border-gray-300 text-gray-600"
                  }`}
                >
                  <div
                    className={`w-8 h-12 rounded border-2 flex ${
                      pos.id === "top" ? "items-start pt-1" : pos.id === "center" ? "items-center" : "items-end pb-1"
                    } justify-center ${position === pos.id ? "border-indigo-400" : "border-gray-300"}`}
                  >
                    <div className={`w-5 h-1 rounded ${position === pos.id ? "bg-indigo-400" : "bg-gray-300"}`} />
                  </div>
                  <span className="text-xs font-medium">{pos.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Animation */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Animation</Label>
            <div className="grid grid-cols-2 gap-2">
              {animations.map((anim) => (
                <button
                  key={anim.id}
                  onClick={() => onAnimationChange(anim.id)}
                  className={`p-3 rounded-xl border-2 text-left transition-all ${
                    animation === anim.id
                      ? "border-indigo-500 bg-indigo-50"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <p className="text-sm font-medium text-gray-800">{anim.label}</p>
                  <p className="text-xs text-gray-500">{anim.description}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Live Preview */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Preview</Label>
            <div
              className="h-24 rounded-xl flex items-end justify-center p-4"
              style={{ backgroundColor: "#1a1a1a" }}
            >
              <div
                className="text-center font-bold"
                style={{
                  fontSize: `${Math.min(fontSize * 0.5, 24)}px`,
                  fontFamily: style.fontFamily,
                }}
              >
                <span style={{ color: style.highlightColor }}>Your </span>
                <span style={{ color: style.primaryColor }}>subtitles here</span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
