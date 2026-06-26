"use client";

import React, { useState, useRef, useEffect } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface VideoPreviewProps {
  videoUrl: string | null;
  isProcessing: boolean;
  progress: number;
  currentStep: string;
  aspectRatio: string;
  onTimeUpdate?: (time: number) => void;
  currentTime?: number;
}

export function VideoPreview({
  videoUrl,
  isProcessing,
  progress,
  currentStep,
  aspectRatio,
  onTimeUpdate,
  currentTime = 0,
}: VideoPreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [duration, setDuration] = useState(0);
  const [localTime, setLocalTime] = useState(0);

  const aspectDimensions = {
    "9:16": { width: 270, height: 480 },
    "16:9": { width: 480, height: 270 },
    "1:1": { width: 360, height: 360 },
    "4:5": { width: 320, height: 400 },
  };

  const dims = aspectDimensions[aspectRatio as keyof typeof aspectDimensions] || aspectDimensions["9:16"];

  useEffect(() => {
    if (videoRef.current && Math.abs(videoRef.current.currentTime - currentTime) > 0.5) {
      videoRef.current.currentTime = currentTime;
    }
  }, [currentTime]);

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setLocalTime(videoRef.current.currentTime);
      onTimeUpdate?.(videoRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      setLocalTime(time);
    }
  };

  const formatTime = (time: number) => {
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const skip = (seconds: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = Math.max(0, Math.min(duration, videoRef.current.currentTime + seconds));
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-full bg-gray-50 p-6">
      {/* Preview Container */}
      <div
        className="relative bg-black rounded-2xl overflow-hidden shadow-2xl"
        style={{ width: dims.width, height: dims.height }}
      >
        {videoUrl ? (
          <>
            <video
              ref={videoRef}
              src={videoUrl}
              className="w-full h-full object-cover"
              onTimeUpdate={handleTimeUpdate}
              onLoadedMetadata={handleLoadedMetadata}
              onEnded={() => setIsPlaying(false)}
              muted={isMuted}
              playsInline
            />
            {/* Overlay controls on hover */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 hover:opacity-100 transition-opacity">
              <div className="absolute bottom-4 left-4 right-4">
                <div className="flex items-center gap-2 text-white text-xs mb-2">
                  <span>{formatTime(localTime)}</span>
                  <div className="flex-1 h-1 bg-white/30 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-white rounded-full transition-all"
                      style={{ width: `${(localTime / duration) * 100}%` }}
                    />
                  </div>
                  <span>{formatTime(duration)}</span>
                </div>
              </div>
            </div>
          </>
        ) : isProcessing ? (
          <div className="flex flex-col items-center justify-center h-full text-white p-6">
            {/* Animated processing indicator */}
            <div className="relative mb-6">
              <div className="w-20 h-20 rounded-full border-4 border-indigo-200 border-t-indigo-500 animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-lg font-bold">{progress}%</span>
              </div>
            </div>
            <p className="text-sm font-medium text-center mb-2">{currentStep}</p>
            <div className="w-full bg-gray-700 rounded-full h-1.5 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 p-6">
            <div className="w-16 h-16 rounded-full bg-gray-800 flex items-center justify-center mb-4">
              <Play size={24} className="ml-1" />
            </div>
            <p className="text-sm text-center">Your video preview will appear here</p>
          </div>
        )}
      </div>

      {/* Playback Controls */}
      {videoUrl && (
        <div className="mt-6 flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => skip(-5)} className="text-gray-600">
            <SkipBack size={18} />
          </Button>
          <Button
            onClick={togglePlay}
            className="w-12 h-12 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            {isPlaying ? <Pause size={20} /> : <Play size={20} className="ml-0.5" />}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => skip(5)} className="text-gray-600">
            <SkipForward size={18} />
          </Button>
          <div className="w-px h-6 bg-gray-200 mx-2" />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsMuted(!isMuted)}
            className="text-gray-600"
          >
            {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </Button>
          <div className="w-px h-6 bg-gray-200 mx-2" />
          <Button variant="ghost" size="sm" asChild className="text-gray-600">
            <a href={videoUrl} download>
              <Download size={18} />
            </a>
          </Button>
        </div>
      )}

      {/* Scrubber */}
      {videoUrl && duration > 0 && (
        <div className="mt-4 w-full max-w-md">
          <input
            type="range"
            min={0}
            max={duration}
            step={0.1}
            value={localTime}
            onChange={handleSeek}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
          />
        </div>
      )}
    </div>
  );
}
