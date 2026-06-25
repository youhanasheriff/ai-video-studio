"use client";

import React, { useState } from "react";
import { Volume2, Play, Pause, User, Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { VOICES } from "@/lib/types";

interface VoiceEditorProps {
  voice: string;
  onVoiceChange: (voice: string) => void;
  speed: number;
  onSpeedChange: (speed: number) => void;
}

export function VoiceEditor({ voice, onVoiceChange, speed, onSpeedChange }: VoiceEditorProps) {
  const [previewPlaying, setPreviewPlaying] = useState<string | null>(null);

  const handlePreview = (voiceId: string) => {
    // In a real app, this would play a sample audio
    if (previewPlaying === voiceId) {
      setPreviewPlaying(null);
    } else {
      setPreviewPlaying(voiceId);
      // Auto-stop after 3 seconds (simulated)
      setTimeout(() => setPreviewPlaying(null), 3000);
    }
  };

  return (
    <div className="space-y-6">
      {/* Voice Selection */}
      <div className="space-y-3">
        <Label className="text-sm font-medium flex items-center gap-2">
          <Mic size={14} />
          AI Voice
        </Label>
        <div className="space-y-2">
          {VOICES.map((v) => (
            <button
              key={v.id}
              onClick={() => onVoiceChange(v.id)}
              className={`w-full p-4 rounded-xl border-2 transition-all flex items-center gap-4 ${
                voice === v.id
                  ? "border-indigo-500 bg-indigo-50"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              {/* Avatar */}
              <div
                className={`w-12 h-12 rounded-full flex items-center justify-center ${
                  voice === v.id ? "bg-indigo-100" : "bg-gray-100"
                }`}
              >
                <User
                  size={20}
                  className={voice === v.id ? "text-indigo-600" : "text-gray-400"}
                />
              </div>

              {/* Info */}
              <div className="flex-1 text-left">
                <p className="font-medium text-gray-800">{v.name}</p>
                <p className="text-sm text-gray-500">{v.description}</p>
              </div>

              {/* Gender tag */}
              <span
                className={`px-2 py-1 rounded-full text-xs font-medium ${
                  v.gender === "female"
                    ? "bg-pink-100 text-pink-700"
                    : v.gender === "male"
                    ? "bg-blue-100 text-blue-700"
                    : "bg-gray-100 text-gray-700"
                }`}
              >
                {v.gender}
              </span>

              {/* Preview button */}
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  handlePreview(v.id);
                }}
                className="text-gray-500 hover:text-indigo-600"
              >
                {previewPlaying === v.id ? (
                  <Pause size={16} />
                ) : (
                  <Play size={16} />
                )}
              </Button>
            </button>
          ))}
        </div>
      </div>

      {/* Speed Control */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium flex items-center gap-2">
            <Volume2 size={14} />
            Speaking Speed
          </Label>
          <span className="text-sm font-mono text-gray-500">{speed.toFixed(1)}x</span>
        </div>

        <div className="relative">
          <input
            type="range"
            min={0.5}
            max={2.0}
            step={0.1}
            value={speed}
            onChange={(e) => onSpeedChange(parseFloat(e.target.value))}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
          />

          {/* Speed markers */}
          <div className="flex justify-between mt-2">
            <button
              onClick={() => onSpeedChange(0.5)}
              className={`px-2 py-1 rounded text-xs transition-colors ${
                speed === 0.5
                  ? "bg-indigo-100 text-indigo-700"
                  : "text-gray-400 hover:text-gray-600"
              }`}
            >
              0.5x
            </button>
            <button
              onClick={() => onSpeedChange(1.0)}
              className={`px-2 py-1 rounded text-xs transition-colors ${
                speed === 1.0
                  ? "bg-indigo-100 text-indigo-700"
                  : "text-gray-400 hover:text-gray-600"
              }`}
            >
              1.0x
            </button>
            <button
              onClick={() => onSpeedChange(1.5)}
              className={`px-2 py-1 rounded text-xs transition-colors ${
                speed === 1.5
                  ? "bg-indigo-100 text-indigo-700"
                  : "text-gray-400 hover:text-gray-600"
              }`}
            >
              1.5x
            </button>
            <button
              onClick={() => onSpeedChange(2.0)}
              className={`px-2 py-1 rounded text-xs transition-colors ${
                speed === 2.0
                  ? "bg-indigo-100 text-indigo-700"
                  : "text-gray-400 hover:text-gray-600"
              }`}
            >
              2.0x
            </button>
          </div>
        </div>

        {/* Speed description */}
        <p className="text-xs text-gray-500 text-center">
          {speed <= 0.6
            ? "Very slow & deliberate"
            : speed <= 0.9
            ? "Slow & clear"
            : speed <= 1.1
            ? "Natural conversational speed"
            : speed <= 1.4
            ? "Slightly faster, more energetic"
            : speed <= 1.7
            ? "Fast-paced, high energy"
            : "Very fast, rapid delivery"}
        </p>
      </div>

      {/* Estimated Duration */}
      <div className="p-4 bg-gray-50 rounded-xl">
        <p className="text-xs text-gray-500 mb-1">Estimated audio duration</p>
        <p className="text-lg font-semibold text-gray-800">
          ~{Math.round((100 / speed) * 0.3)} seconds
        </p>
        <p className="text-xs text-gray-400">Based on script length and speed</p>
      </div>
    </div>
  );
}
