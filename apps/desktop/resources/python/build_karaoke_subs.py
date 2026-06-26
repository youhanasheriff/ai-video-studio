#!/usr/bin/env python3
"""Generate an ASS subtitle file with karaoke-style per-word highlighting.

Reads whisper word-timestamps JSON and emits an ASS file where words are
revealed as they're spoken: pending words appear dim, the currently-spoken
word flashes bright, then settles into the spoken-color.

Usage:
    python3 scripts/build_karaoke_subs.py \\
        --whisper subtitles/narration.json \\
        --out subtitles/narration.ass \\
        --max-words 6 --max-chars 38
"""
from __future__ import annotations
import argparse, json, re, sys
from pathlib import Path

# ASS color is &HBBGGRR& (alpha-blue-green-red, hex)
PRIMARY   = "&H00FFFFFF"  # bright white — current word fill
SECONDARY = "&H00B0B0B0"  # gray         — pending words (before sweep)
OUTLINE   = "&H00000000"  # black outline
BACK      = "&H80000000"  # semi-transparent black shadow

# Active-word highlight color (replaces PRIMARY for the currently-spoken word).
HIGHLIGHT = "&H0080DDFF"  # warm amber-gold


def fmt_ass_time(t: float) -> str:
    """ASS uses H:MM:SS.CS (centiseconds)."""
    if t < 0: t = 0
    h = int(t // 3600); m = int((t % 3600) // 60); s = t % 60
    return f"{h}:{m:02d}:{s:05.2f}"


PUNCT_BREAK = re.compile(r'[.!?]$')


def group_words_into_lines(words, max_words=6, max_chars=42, max_dur=4.0):
    """Split flat word list into subtitle lines respecting punctuation + budgets."""
    lines = []
    cur = []
    cur_chars = 0
    cur_start = None
    for w in words:
        text = w['word'].strip()
        if not text:
            continue
        if cur_start is None:
            cur_start = w['start']
        prospective_chars = cur_chars + (1 if cur else 0) + len(text)
        prospective_dur = w['end'] - cur_start
        force_break = (
            len(cur) >= max_words or
            prospective_chars > max_chars or
            prospective_dur > max_dur
        )
        if force_break and cur:
            lines.append(cur)
            cur = []
            cur_chars = 0
            cur_start = w['start']
        cur.append(w)
        cur_chars = sum(len(x['word'].strip()) for x in cur) + max(0, len(cur)-1)
        # End line on sentence terminator if we already have a reasonable line
        if PUNCT_BREAK.search(text) and len(cur) >= 3:
            lines.append(cur)
            cur = []
            cur_chars = 0
            cur_start = None
    if cur:
        lines.append(cur)
    return lines


def line_to_dialogue(line_words, *, layer=0, style='Karaoke'):
    """Emit a single ASS Dialogue line with karaoke timing + per-word highlight."""
    start = line_words[0]['start']
    # Extend end slightly so the line lingers a beat after the last word.
    end = line_words[-1]['end'] + 0.20
    # Build karaoke string. \k uses centiseconds.
    # For each word we override the active color via inline tag, then karaoke into
    # the spoken (primary) color.
    parts = []
    for w in line_words:
        text = w['word'].strip()
        dur_cs = max(1, int(round((w['end'] - w['start']) * 100)))
        # \kf = fill karaoke (sweeps across); \1c sets primary at runtime.
        # Pattern: secondary text by default, when \kf time elapses primary takes over.
        # To get an extra "active" flash on the current word, surround it with
        # \1c={HIGHLIGHT} just before \kf and revert to \1c={PRIMARY} after.
        parts.append(f"{{\\1c{HIGHLIGHT}\\kf{dur_cs}}}{text}{{\\1c{PRIMARY}}}")
    # Join with single spaces; ASS treats them literally.
    body = ' '.join(parts)
    return f"Dialogue: {layer},{fmt_ass_time(start)},{fmt_ass_time(end)},{style},,0,0,0,,{body}"


def build_ass(words, *, video_w=1920, video_h=1080, font='Helvetica',
              font_size=56, margin_v=130, **group_kw) -> str:
    header = f"""[Script Info]
Title: Isekai Chronicles ep01 karaoke
ScriptType: v4.00+
PlayResX: {video_w}
PlayResY: {video_h}
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Karaoke,{font},{font_size},{PRIMARY},{SECONDARY},{OUTLINE},{BACK},-1,0,0,0,100,100,0,0,1,3,1,2,80,80,{margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    lines = group_words_into_lines(words, **group_kw)
    body = '\n'.join(line_to_dialogue(l) for l in lines if l)
    return header + body + '\n'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--whisper', required=True, help='whisper JSON with word_timestamps')
    ap.add_argument('--out', required=True, help='output .ass path')
    ap.add_argument('--video-w', type=int, default=1920)
    ap.add_argument('--video-h', type=int, default=1080)
    ap.add_argument('--font', default='Helvetica')
    ap.add_argument('--font-size', type=int, default=56)
    ap.add_argument('--margin-v', type=int, default=130)
    ap.add_argument('--max-words', type=int, default=6)
    ap.add_argument('--max-chars', type=int, default=42)
    ap.add_argument('--max-dur', type=float, default=4.0)
    args = ap.parse_args()

    data = json.loads(Path(args.whisper).read_text(encoding='utf-8'))
    flat = []
    for seg in data.get('segments', []):
        for w in (seg.get('words') or []):
            if w.get('word') and w.get('start') is not None and w.get('end') is not None:
                flat.append(w)
    if not flat:
        sys.exit('no word timestamps found in whisper JSON')

    ass = build_ass(
        flat,
        video_w=args.video_w, video_h=args.video_h,
        font=args.font, font_size=args.font_size, margin_v=args.margin_v,
        max_words=args.max_words, max_chars=args.max_chars, max_dur=args.max_dur,
    )
    Path(args.out).write_text(ass, encoding='utf-8')
    print(f'wrote {args.out}: {len(flat)} words, {ass.count("Dialogue:")} subtitle lines')


if __name__ == '__main__':
    main()
