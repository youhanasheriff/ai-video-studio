#!/usr/bin/env python3
"""CosyVoice local TTS wrapper for story-video-pipeline.

Supports both CosyVoice v1 (CosyVoice-300M-SFT, named speakers) and v3
(Fun-CosyVoice3-0.5B, zero-shot voice cloning + instruction control). The mode
is auto-detected from the model dir name, or set explicitly via --mode.

For v3 (default for cinematic narration), the wrapper:
  * Clones a target voice from a clean reference audio clip.
  * Wraps each chunk's text with a narrator instruction via `<|endofprompt|>`.
  * Optionally inserts [breath] markers at sentence ends for natural pauses.
  * Uses `inference_cross_lingual` because it explicitly supports [breath]
    markup alongside the instruction prefix.

Output is uniformly re-encoded to 22050 Hz mono PCM 16-bit, so the downstream
concat doesn't end up with the mixed-bit-depth corruption we hit on the China
project.

Run inside the CosyVoice conda env:
  conda run -n cosyvoice python scripts/cosyvoice_tts.py --project projects/X
"""
from __future__ import annotations
import argparse, json, re, subprocess, sys, tempfile
from pathlib import Path


SENT_END = re.compile(r'([.!?])\s+(?=[A-Z\[\(\"\'])')


def split_text(script: str):
    parts=[]
    current=[]; sid=0; title=''
    for line in script.splitlines():
        m=re.match(r'^## Scene\s+(\d+):\s*(.*)', line.strip())
        if m:
            if current and sid:
                text=' '.join(x.strip() for x in current if x.strip())
                parts.append({'scene_id':sid,'title':title,'text':text})
            sid=int(m.group(1)); title=m.group(2); current=[]
            continue
        if sid and not line.startswith('#') and not line.startswith('TODO'):
            current.append(line)
    if current and sid:
        parts.append({'scene_id':sid,'title':title,'text':' '.join(x.strip() for x in current if x.strip())})
    return parts


def insert_breath_markers(text: str, every_n: int = 2) -> str:
    """Insert [breath] markers after every Nth sentence boundary.

    Skips the final sentence so we don't end on a [breath]."""
    # First split into pieces by sentence-end punctuation, keeping the punctuation.
    pieces = re.split(r'([.!?])\s+', text)
    # pieces alternates: sentence_body, punctuation, sentence_body, ...
    out=[]; sent_idx=0
    i=0
    while i < len(pieces):
        body = pieces[i]
        out.append(body)
        if i+1 < len(pieces):
            punct = pieces[i+1]
            out.append(punct)
            sent_idx += 1
            # Add a breath after this sentence, but not if it's the last one.
            if sent_idx % every_n == 0 and i+2 < len(pieces) and pieces[i+2].strip():
                out.append(' [breath] ')
            else:
                out.append(' ')
        i += 2
    return ''.join(out).rstrip()


def read_config_value(cfg_path: Path, key: str, default=None):
    """Tiny YAML key reader for top-level-nested simple keys like `tts.cosyvoice_speaker`."""
    if not cfg_path.exists(): return default
    target = key.split('.')[-1]
    for line in cfg_path.read_text(encoding='utf-8').splitlines():
        m=re.match(rf'\s*{re.escape(target)}:\s*["\']?([^"\'#\n]+?)["\']?\s*(#.*)?$', line)
        if m: return m.group(1).strip()
    return default


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--project', required=True)
    ap.add_argument('--cosyvoice-dir', default='/Users/youhanasheriff/CosyVoice')
    ap.add_argument('--model-dir', default=None,
                    help='override config tts.cosyvoice_model_dir')
    ap.add_argument('--mode', choices=['auto','v1','v3'], default='auto',
                    help='v1 = SFT named speaker; v3 = zero-shot + instruction. auto inspects model dir name.')
    ap.add_argument('--speaker', default=None,
                    help='v1 mode: override config tts.cosyvoice_speaker (default 中文女)')
    ap.add_argument('--reference-audio', default=None,
                    help='v3 mode: path to clean reference clip for voice cloning')
    ap.add_argument('--instruction', default=None,
                    help='v3 mode: narrator instruction; merged with <|endofprompt|>')
    ap.add_argument('--add-breath', action='store_true', default=None,
                    help='v3 mode: insert [breath] markers at sentence ends')
    ap.add_argument('--breath-every', type=int, default=2,
                    help='v3 mode: insert [breath] every N sentences')
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--force', action='store_true')
    args=ap.parse_args()
    project=Path(args.project).resolve(); audio=project/'audio'; audio.mkdir(exist_ok=True)

    cfg_path = project/'config.yaml'
    if args.model_dir is None:
        args.model_dir = (read_config_value(cfg_path, 'tts.cosyvoice_model_dir')
                          or '/Users/youhanasheriff/CosyVoice/pretrained_models/CosyVoice-300M-SFT')
    model = Path(args.model_dir).resolve()
    if args.mode == 'auto':
        name = model.name.lower()
        args.mode = 'v3' if ('cosyvoice3' in name or 'cosyvoice-3' in name or 'fun-cosyvoice3' in name) else 'v1'
    print(f'cosyvoice_tts: mode={args.mode} model_dir={model}', flush=True)

    if args.mode == 'v1':
        if args.speaker is None:
            args.speaker = read_config_value(cfg_path, 'tts.cosyvoice_speaker') or '中文女'
        print(f'  v1 speaker: {args.speaker!r}', flush=True)
    else:
        if args.reference_audio is None:
            args.reference_audio = read_config_value(cfg_path, 'tts.cosyvoice_reference_audio')
        if args.reference_audio is None:
            raise SystemExit('v3 mode requires --reference-audio or tts.cosyvoice_reference_audio in config.yaml')
        ref = Path(args.reference_audio).resolve()
        if not ref.exists(): raise SystemExit(f'reference audio not found: {ref}')
        if args.instruction is None:
            args.instruction = (read_config_value(cfg_path, 'tts.cosyvoice_instruction')
                                or 'You are a helpful narrator. Read this with a warm, slow, cinematic narrator voice, with quiet wonder at moments of awe and gentle weight at moments of stakes.')
        if args.add_breath is None:
            args.add_breath = (read_config_value(cfg_path, 'tts.cosyvoice_add_breath_markers') or 'true').lower() in ('1','true','yes','on')
        print(f'  v3 reference: {ref}', flush=True)
        print(f'  v3 instruction: {args.instruction[:80]}...', flush=True)
        print(f'  v3 breath markers: {args.add_breath} (every {args.breath_every} sentences)', flush=True)

    cosy=Path(args.cosyvoice_dir).resolve()
    if not cosy.exists(): raise SystemExit(f'CosyVoice repo missing: {cosy}')
    if not model.exists(): raise SystemExit(f'CosyVoice model missing: {model}. Download it first.')

    script=(project/'script.md').read_text(encoding='utf-8')
    chunks=split_text(script)
    if args.limit: chunks=chunks[:args.limit]

    # Preprocess text per chunk if v3.
    if args.mode == 'v3' and args.add_breath:
        for c in chunks:
            c['text'] = insert_breath_markers(c['text'], every_n=args.breath_every)

    # Build worker config that gets serialized to disk and passed to the worker.
    worker_cfg = {
        'mode': args.mode,
        'model_dir': str(model),
        'speaker': args.speaker if args.mode=='v1' else None,
        'reference_audio': str(Path(args.reference_audio).resolve()) if args.mode=='v3' else None,
        'instruction': args.instruction if args.mode=='v3' else None,
        'items': chunks,
    }

    worker = r'''
import sys, json
from pathlib import Path
sys.path.insert(0, str(Path.cwd()))
sys.path.append('third_party/Matcha-TTS')
from cosyvoice.cli.cosyvoice import AutoModel
import torchaudio, torch

cfg = json.loads(Path(sys.argv[1]).read_text())
outdir = Path(sys.argv[2]); outdir.mkdir(parents=True, exist_ok=True)
mode = cfg['mode']
print(f'worker: loading model from {cfg["model_dir"]}', flush=True)
cosyvoice = AutoModel(model_dir=cfg['model_dir'])
SR = cosyvoice.sample_rate
print(f'worker: model loaded, sample_rate={SR}', flush=True)

def save_uniform_wav(tensor, path: Path):
    # Force 16-bit PCM to avoid mixed-depth concat corruption.
    # tensor shape may be [1, T] or [T]. Make it [1, T] float in [-1, 1].
    if tensor.dim() == 1:
        tensor = tensor.unsqueeze(0)
    tensor = tensor.to(torch.float32).clamp(-1, 1)
    # torchaudio.save with bits_per_sample=16 forces s16le PCM.
    torchaudio.save(str(path), tensor, SR, encoding='PCM_S', bits_per_sample=16)

for item in cfg['items']:
    sid = int(item['scene_id']); text = item['text']
    out = outdir/f'chunk_{sid:04d}.wav'
    if out.exists() and out.stat().st_size > 0:
        print(f'exists {out}', flush=True); continue
    pieces=[]
    try:
        if mode == 'v1':
            iterator = cosyvoice.inference_sft(text, cfg['speaker'], stream=False)
        else:
            # v3 cross_lingual supports [breath] markup + instruction prefix via <|endofprompt|>.
            instr = cfg['instruction']
            full_text = f'{instr}<|endofprompt|>{text}'
            iterator = cosyvoice.inference_cross_lingual(full_text, cfg['reference_audio'], stream=False)
        for i, j in enumerate(iterator):
            tmp = outdir/f'.chunk_{sid:04d}_{i}.wav'
            save_uniform_wav(j['tts_speech'], tmp)
            pieces.append(tmp)
    except Exception as e:
        print(f'! scene {sid:04d} inference failed: {e}', flush=True)
        for p in pieces: p.unlink(missing_ok=True)
        raise
    if len(pieces) == 1:
        pieces[0].replace(out)
    else:
        concat = outdir/f'.chunk_{sid:04d}.txt'
        concat.write_text(''.join([f"file {str(p)!r}\n" for p in pieces]))
        import subprocess
        subprocess.run(['ffmpeg','-y','-f','concat','-safe','0','-i',str(concat),
                        '-ar', str(SR), '-ac', '1', '-c:a', 'pcm_s16le', str(out)],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        for p in pieces: p.unlink(missing_ok=True)
        concat.unlink(missing_ok=True)
    print(f'generated {out}', flush=True)
'''
    with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as f:
        json.dump(worker_cfg, f); cfg_path_tmp = f.name
    worker_path = audio/'_cosy_worker.py'
    worker_path.write_text(worker)
    cmd = [sys.executable, str(worker_path), cfg_path_tmp, str(audio)]
    subprocess.run(cmd, cwd=cosy, check=True)

    # Build concatenated narration with uniform 16-bit PCM (avoid the mixed-depth bug).
    wavs = sorted(audio.glob('chunk_*.wav'))
    concat = audio/'concat.txt'
    concat.write_text(''.join([f"file {str(p)!r}\n" for p in wavs]), encoding='utf-8')
    narration = audio/'narration.wav'
    subprocess.run(['ffmpeg','-y','-f','concat','-safe','0','-i',str(concat),
                    '-ar','22050','-ac','1','-c:a','pcm_s16le', str(narration)],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    def dur(p: Path):
        out = subprocess.check_output(
            ['ffprobe','-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',str(p)],
            text=True)
        return float(out.strip() or 0)
    t = 0.0; stamps=[]
    for p in wavs:
        d = dur(p); sid = int(p.stem.split('_')[1])
        stamps.append({'scene_id':sid,'chunk_path':str(p),'start_seconds':t,'duration_seconds':d}); t += d
    meta = {
        'provider': 'cosyvoice_local',
        'mode': args.mode,
        'model_dir': str(model),
        'total_duration_seconds': t,
        'chunks': stamps,
    }
    if args.mode == 'v1':
        meta['speaker'] = args.speaker
    else:
        meta['reference_audio'] = str(Path(args.reference_audio).resolve())
        meta['instruction'] = args.instruction
        meta['breath_markers'] = args.add_breath
    (audio/'timestamps.json').write_text(json.dumps(meta, indent=2), encoding='utf-8')
    print(f'CosyVoice narration written: {narration} duration={t:.2f}s ({t/60:.2f} min) chunks={len(wavs)}', flush=True)


if __name__=='__main__': main()
