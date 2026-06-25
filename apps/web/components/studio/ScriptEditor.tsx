"use client";

import React, { useState, useEffect } from "react";
import { Type, Sparkles, Tag, X, Plus, FileText, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";

interface ScriptEditorProps {
  script: string;
  onScriptChange: (script: string) => void;
  keywords: string[];
  onKeywordsChange: (keywords: string[]) => void;
}

export function ScriptEditor({
  script,
  onScriptChange,
  keywords,
  onKeywordsChange,
}: ScriptEditorProps) {
  const [keywordInput, setKeywordInput] = useState("");
  const [wordCount, setWordCount] = useState(0);
  const [charCount, setCharCount] = useState(0);

  useEffect(() => {
    const words = script.trim().split(/\s+/).filter(Boolean);
    setWordCount(words.length);
    setCharCount(script.length);
  }, [script]);

  const addKeyword = () => {
    const trimmed = keywordInput.trim().toLowerCase();
    if (trimmed && !keywords.includes(trimmed) && keywords.length < 5) {
      onKeywordsChange([...keywords, trimmed]);
      setKeywordInput("");
    }
  };

  const removeKeyword = (keyword: string) => {
    onKeywordsChange(keywords.filter((k) => k !== keyword));
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addKeyword();
    }
  };

  // Extract suggested keywords from script
  const suggestKeywords = () => {
    const stopWords = new Set([
      "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
      "have", "has", "had", "do", "does", "did", "will", "would", "could",
      "should", "may", "might", "must", "shall", "can", "to", "of", "in",
      "for", "on", "with", "at", "by", "from", "as", "into", "through",
      "and", "but", "or", "if", "this", "that", "these", "those", "it",
      "you", "your", "we", "our", "they", "their", "i", "me", "my",
    ]);

    const words = script.toLowerCase().match(/\b[a-z]{4,}\b/g) || [];
    const counts: Record<string, number> = {};

    words.forEach((word) => {
      if (!stopWords.has(word) && !keywords.includes(word)) {
        counts[word] = (counts[word] || 0) + 1;
      }
    });

    const suggested = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([word]) => word);

    if (suggested.length > 0 && keywords.length < 5) {
      const newKeywords = [...keywords, ...suggested.slice(0, 5 - keywords.length)];
      onKeywordsChange(newKeywords);
    }
  };

  const estimatedDuration = Math.ceil(wordCount / 2.5); // ~150 words per minute

  return (
    <div className="space-y-6">
      {/* Script Input */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium flex items-center gap-2">
            <FileText size={14} />
            Video Script
          </Label>
          <span className="text-xs text-gray-400">
            {wordCount} words • ~{estimatedDuration}s
          </span>
        </div>

        <Textarea
          value={script}
          onChange={(e) => onScriptChange(e.target.value)}
          placeholder="Write your video script here. This text will be converted to speech and used to find matching stock footage..."
          className="min-h-[200px] resize-none bg-white border-gray-200 focus:border-indigo-500 focus:ring-indigo-500/20 rounded-xl text-sm leading-relaxed"
        />

        {/* Script stats */}
        <div className="flex items-center justify-between text-xs text-gray-400">
          <span>{charCount} characters</span>
          <span>
            Estimated duration: <strong className="text-gray-600">{estimatedDuration} seconds</strong>
          </span>
        </div>
      </div>

      {/* Keywords */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium flex items-center gap-2">
            <Tag size={14} />
            Stock Footage Keywords
          </Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={suggestKeywords}
            className="text-xs text-indigo-600 hover:text-indigo-700"
            disabled={script.length < 20}
          >
            <Wand2 size={12} className="mr-1" />
            Auto-suggest
          </Button>
        </div>

        <div className="flex gap-2">
          <Input
            value={keywordInput}
            onChange={(e) => setKeywordInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Add keyword..."
            className="bg-white border-gray-200 rounded-xl text-sm"
            disabled={keywords.length >= 5}
          />
          <Button
            type="button"
            onClick={addKeyword}
            variant="outline"
            className="rounded-xl px-4"
            disabled={keywords.length >= 5 || !keywordInput.trim()}
          >
            <Plus size={16} />
          </Button>
        </div>

        {/* Keywords list */}
        {keywords.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {keywords.map((keyword, index) => (
              <span
                key={keyword}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-full text-sm font-medium group"
              >
                <span className="w-5 h-5 rounded-full bg-indigo-100 flex items-center justify-center text-xs">
                  {index + 1}
                </span>
                {keyword}
                <button
                  type="button"
                  onClick={() => removeKeyword(keyword)}
                  className="ml-1 text-indigo-400 hover:text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X size={14} />
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-400 italic">
            Keywords help find relevant stock footage. Add your own or use auto-suggest.
          </p>
        )}

        <p className="text-xs text-gray-400">
          {5 - keywords.length} keywords remaining • Each keyword fetches a matching video clip
        </p>
      </div>

      {/* Tips */}
      <div className="p-4 bg-amber-50 border border-amber-100 rounded-xl">
        <p className="text-xs font-medium text-amber-800 mb-2 flex items-center gap-1">
          <Sparkles size={12} />
          Tips for better videos
        </p>
        <ul className="text-xs text-amber-700 space-y-1">
          <li>• Keep sentences short and punchy for social media</li>
          <li>• Start with a hook to grab attention</li>
          <li>• Use specific keywords for better footage matches</li>
        </ul>
      </div>
    </div>
  );
}
