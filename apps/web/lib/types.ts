// Types for AI Video Studio

export interface Project {
  id: string;
  name: string;
  script: string;
  keywords: string[];
  voice: VoiceSettings;
  subtitles: SubtitleSettings;
  footage: FootageClip[];
  status: 'draft' | 'processing' | 'completed' | 'failed';
  outputUrl?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface VoiceSettings {
  model: string;
  voice: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';
  speed: number;
}

export interface SubtitleSettings {
  enabled: boolean;
  style: SubtitleStyle;
  fontSize: number;
  position: 'top' | 'center' | 'bottom';
  animation: 'none' | 'fade' | 'karaoke' | 'typewriter';
}

export interface SubtitleStyle {
  name: string;
  primaryColor: string;
  highlightColor: string;
  backgroundColor: string;
  fontFamily: string;
}

export interface FootageClip {
  id: string;
  keyword: string;
  videoUrl: string;
  thumbnailUrl: string;
  duration: number;
  startTime: number;
  endTime: number;
  provider: 'pexels' | 'pixabay';
}

export interface SubtitleSegment {
  id: string;
  text: string;
  startTime: number;
  endTime: number;
  words: WordTimestamp[];
}

export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}

export interface GenerationTask {
  taskId: string;
  status: 'PENDING' | 'STARTED' | 'SUCCESS' | 'FAILURE';
  progress: number;
  currentStep: string;
  outputUrl?: string;
  error?: string;
}

export interface VideoExportSettings {
  format: 'mp4' | 'webm';
  quality: 'standard' | 'hd' | '4k';
  aspectRatio: '9:16' | '16:9' | '1:1' | '4:5';
}

// Voice options
export const VOICES = [
  { id: 'nova', name: 'Nova', description: 'Warm & friendly', gender: 'female' },
  { id: 'alloy', name: 'Alloy', description: 'Neutral & balanced', gender: 'neutral' },
  { id: 'echo', name: 'Echo', description: 'Warm & natural', gender: 'male' },
  { id: 'fable', name: 'Fable', description: 'British accent', gender: 'neutral' },
  { id: 'onyx', name: 'Onyx', description: 'Deep & authoritative', gender: 'male' },
  { id: 'shimmer', name: 'Shimmer', description: 'Clear & expressive', gender: 'female' },
] as const;

// Subtitle style presets
export const SUBTITLE_PRESETS: SubtitleStyle[] = [
  { name: 'Classic', primaryColor: '#FFFFFF', highlightColor: '#FFFF00', backgroundColor: 'transparent', fontFamily: 'Inter' },
  { name: 'Bold Pop', primaryColor: '#FFFFFF', highlightColor: '#FF3366', backgroundColor: '#000000', fontFamily: 'Inter' },
  { name: 'Minimal', primaryColor: '#1a1a1a', highlightColor: '#1a1a1a', backgroundColor: 'transparent', fontFamily: 'Inter' },
  { name: 'Neon', primaryColor: '#00FF88', highlightColor: '#FF00FF', backgroundColor: 'transparent', fontFamily: 'Inter' },
  { name: 'Warm', primaryColor: '#FFE4B5', highlightColor: '#FF6B35', backgroundColor: 'transparent', fontFamily: 'Inter' },
  { name: 'Ocean', primaryColor: '#E0F7FA', highlightColor: '#00BCD4', backgroundColor: 'transparent', fontFamily: 'Inter' },
];

// Aspect ratio options
export const ASPECT_RATIOS = [
  { id: '9:16', name: 'Portrait', description: 'TikTok, Reels, Shorts', width: 1080, height: 1920 },
  { id: '16:9', name: 'Landscape', description: 'YouTube, Desktop', width: 1920, height: 1080 },
  { id: '1:1', name: 'Square', description: 'Instagram Feed', width: 1080, height: 1080 },
  { id: '4:5', name: 'Portrait Feed', description: 'Instagram, Facebook', width: 1080, height: 1350 },
] as const;
