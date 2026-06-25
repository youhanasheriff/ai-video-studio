"use client";

import React, { useState, useEffect } from "react";
import axios from "axios";
import {
  Video,
  FileText,
  Mic,
  Type,
  Settings,
  FolderOpen,
  Plus,
  Sparkles,
  Loader2,
  ChevronRight,
  Clock,
  Zap,
  PlayCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { VideoPreview } from "@/components/studio/VideoPreview";
import { ScriptEditor } from "@/components/studio/ScriptEditor";
import { VoiceEditor } from "@/components/studio/VoiceEditor";
import { SubtitleEditor } from "@/components/studio/SubtitleEditor";
import { ExportSettings } from "@/components/studio/ExportSettings";
import { SUBTITLE_PRESETS, type SubtitleStyle } from "@/lib/types";

type Tab = "script" | "voice" | "subtitles" | "export";

export default function StudioPage() {
  const [mounted, setMounted] = useState(false);

  // Video generation state
  const [isProcessing, setIsProcessing] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [script, setScript] = useState(
    "Discover the future of technology. Artificial intelligence is transforming industries, creating new possibilities, and reshaping how we connect with the world.",
  );
  const [keywords, setKeywords] = useState<string[]>([]);
  const [voice, setVoice] = useState("nova");
  const [voiceSpeed, setVoiceSpeed] = useState(1.0);
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(true);
  const [subtitleStyle, setSubtitleStyle] = useState<SubtitleStyle>(
    SUBTITLE_PRESETS[0],
  );
  const [subtitleFontSize, setSubtitleFontSize] = useState(48);
  const [subtitlePosition, setSubtitlePosition] = useState<
    "top" | "center" | "bottom"
  >("bottom");
  const [subtitleAnimation, setSubtitleAnimation] = useState("karaoke");
  const [aspectRatio, setAspectRatio] = useState("9:16");

  // UI state
  const [activeTab, setActiveTab] = useState<Tab>("script");
  const [recentProjects] = useState([
    {
      id: "1",
      name: "Product Launch Video",
      date: "2 hours ago",
      status: "completed",
    },
    {
      id: "2",
      name: "Marketing Campaign",
      date: "Yesterday",
      status: "completed",
    },
  ]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Polling for task status
  useEffect(() => {
    let interval: NodeJS.Timeout;

    if (taskId && isProcessing) {
      interval = setInterval(async () => {
        try {
          const apiUrl =
            process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
          const response = await axios.get(`${apiUrl}/status/${taskId}`);
          const data = response.data;

          setProgress(data.progress || 0);
          setCurrentStep(data.current_step || data.status);

          if (data.status === "SUCCESS") {
            const url = data.output_url?.startsWith("/")
              ? `${apiUrl}${data.output_url}`
              : data.output_url;
            setVideoUrl(url);
            setIsProcessing(false);
            setTaskId(null);
          } else if (data.status === "FAILURE") {
            setError(data.error || "Generation failed");
            setIsProcessing(false);
            setTaskId(null);
          }
        } catch (err) {
          console.error("Polling error:", err);
        }
      }, 1500);
    }

    return () => clearInterval(interval);
  }, [taskId, isProcessing]);

  const handleGenerate = async () => {
    try {
      setIsProcessing(true);
      setError(null);
      setVideoUrl(null);
      setProgress(0);
      setCurrentStep("Starting generation...");

      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const response = await axios.post(`${apiUrl}/generate`, {
        script,
        keywords: keywords.length > 0 ? keywords : undefined,
        voice,
        voice_speed: voiceSpeed,
        subtitles_enabled: subtitlesEnabled,
        subtitle_style: subtitleStyle.name.toLowerCase(),
        subtitle_font: subtitleStyle.fontFamily,
        subtitle_font_size: subtitleFontSize,
        subtitle_primary_color: subtitleStyle.primaryColor,
        subtitle_highlight_color: subtitleStyle.highlightColor,
        subtitle_outline_color: "#000000",
        subtitle_outline_width: 3,
        subtitle_shadow_depth: 2,
        subtitle_position: subtitlePosition,
        subtitle_words_per_line: 4,
        aspect_ratio: aspectRatio,
      });

      if (response.data.task_id) {
        setTaskId(response.data.task_id);
      }
    } catch (err) {
      console.error("Generation error:", err);
      setError("Failed to start generation. Is the server running?");
      setIsProcessing(false);
    }
  };

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "script", label: "Script", icon: FileText },
    { id: "voice", label: "Voice", icon: Mic },
    { id: "subtitles", label: "Subtitles", icon: Type },
    { id: "export", label: "Export", icon: Settings },
  ];

  if (!mounted) return null;

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Left Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
        {/* Logo */}
        <div className="p-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center">
              <Video size={20} className="text-white" />
            </div>
            <div>
              <h1 className="font-bold text-gray-900">AI Studio</h1>
              <p className="text-xs text-gray-400">Video Generator</p>
            </div>
          </div>
        </div>

        {/* New Project Button */}
        <div className="p-4">
          <Button className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl h-11">
            <Plus size={18} className="mr-2" />
            New Project
          </Button>
        </div>

        {/* Recent Projects */}
        <div className="flex-1 overflow-y-auto px-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
              Recent
            </span>
          </div>

          <div className="space-y-1">
            {recentProjects.map((project) => (
              <button
                key={project.id}
                className="w-full p-3 rounded-xl hover:bg-gray-50 text-left transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-gray-100 rounded-lg flex items-center justify-center group-hover:bg-indigo-50">
                    <FolderOpen
                      size={14}
                      className="text-gray-400 group-hover:text-indigo-500"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-700 truncate">
                      {project.name}
                    </p>
                    <p className="text-xs text-gray-400 flex items-center gap-1">
                      <Clock size={10} />
                      {project.date}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="p-4 border-t border-gray-100">
          <div className="p-4 bg-gradient-to-br from-indigo-50 to-purple-50 rounded-xl">
            <div className="flex items-center gap-2 mb-2">
              <Zap size={14} className="text-indigo-600" />
              <span className="text-sm font-medium text-indigo-900">
                Quick tip
              </span>
            </div>
            <p className="text-xs text-indigo-700 leading-relaxed">
              Add specific keywords to get better matching stock footage for
              your video.
            </p>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex">
        {/* Center - Preview */}
        <div className="flex-1 flex flex-col">
          {/* Top bar */}
          <div className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-6">
            <div className="flex items-center gap-3">
              <h2 className="font-semibold text-gray-800">Video Preview</h2>
              {videoUrl && (
                <span className="px-2 py-1 bg-green-100 text-green-700 text-xs font-medium rounded-full">
                  Ready
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-400">Format:</span>
              <span className="text-sm font-medium text-gray-700">
                {aspectRatio}
              </span>
            </div>
          </div>

          {/* Preview Area */}
          <VideoPreview
            videoUrl={videoUrl}
            isProcessing={isProcessing}
            progress={progress}
            currentStep={currentStep}
            aspectRatio={aspectRatio}
          />
        </div>

        {/* Right Panel - Settings */}
        <div className="w-[400px] bg-white border-l border-gray-200 flex flex-col">
          {/* Tabs */}
          <div className="border-b border-gray-100">
            <div className="flex">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex-1 py-4 px-2 text-sm font-medium transition-colors relative ${
                      activeTab === tab.id
                        ? "text-indigo-600"
                        : "text-gray-500 hover:text-gray-700"
                    }`}
                  >
                    <div className="flex items-center justify-center gap-2">
                      <Icon size={16} />
                      <span className="hidden sm:inline">{tab.label}</span>
                    </div>
                    {activeTab === tab.id && (
                      <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {activeTab === "script" && (
              <ScriptEditor
                script={script}
                onScriptChange={setScript}
                keywords={keywords}
                onKeywordsChange={setKeywords}
              />
            )}

            {activeTab === "voice" && (
              <VoiceEditor
                voice={voice}
                onVoiceChange={setVoice}
                speed={voiceSpeed}
                onSpeedChange={setVoiceSpeed}
              />
            )}

            {activeTab === "subtitles" && (
              <SubtitleEditor
                enabled={subtitlesEnabled}
                onEnabledChange={setSubtitlesEnabled}
                style={subtitleStyle}
                onStyleChange={setSubtitleStyle}
                fontSize={subtitleFontSize}
                onFontSizeChange={setSubtitleFontSize}
                position={subtitlePosition}
                onPositionChange={setSubtitlePosition}
                animation={subtitleAnimation}
                onAnimationChange={setSubtitleAnimation}
              />
            )}

            {activeTab === "export" && (
              <ExportSettings
                aspectRatio={aspectRatio}
                onAspectRatioChange={setAspectRatio}
              />
            )}
          </div>

          {/* Generate Button */}
          <div className="p-4 border-t border-gray-100 bg-gray-50">
            {error && (
              <div className="mb-3 p-3 bg-red-50 border border-red-100 rounded-xl">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            <Button
              onClick={handleGenerate}
              disabled={isProcessing || script.length < 10}
              className="w-full h-12 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-semibold rounded-xl shadow-lg shadow-indigo-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isProcessing ? (
                <>
                  <Loader2 size={18} className="mr-2 animate-spin" />
                  Generating... {progress}%
                </>
              ) : videoUrl ? (
                <>
                  <PlayCircle size={18} className="mr-2" />
                  Regenerate Video
                </>
              ) : (
                <>
                  <Sparkles size={18} className="mr-2" />
                  Generate Video
                </>
              )}
            </Button>

            <p className="text-xs text-gray-400 text-center mt-3">
              Video will be generated using AI voiceover and stock footage
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
