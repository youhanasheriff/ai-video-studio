#!/usr/bin/env python3
"""Local image generation via mflux + FLUX.2 klein-4B (series-character aware).

Reads scenes.json + config.yaml from --project. Each scene specifies
`characters_in_scene: ["haruto", "lyndras", ...]`. For each scene the script
looks up matching portraits in the series characters dir
(image.local_flux.series_characters_dir) and passes them as --image-paths to
mflux-generate-flux2-edit, which keeps character appearance consistent across
scenes AND across episodes.

Scenes with empty characters_in_scene (pure environments) use the text-to-image
path (`mflux-generate-flux2`).

Manifest is rewritten after every scene (tmp-then-rename) so a kill never
loses progress.

Requires mflux >= 0.17.5:
    uv tool install --upgrade mflux --with hf_transfer

Companion script: scripts/generate_character_portraits.py — run that first to
produce the per-character portraits this script consumes.
"""
from __future__ import annotations
import argparse, json, os, shutil, subprocess, sys, time
from pathlib import Path

import yaml

MIN_REAL_BYTES = 50_000


def load_config(project: Path) -> dict:
    p = project / 'config.yaml'
    if not p.exists():
        raise SystemExit(f'config.yaml not found at {p}')
    with p.open('r', encoding='utf-8') as f:
        return yaml.safe_load(f) or {}


def local_flux_settings(cfg: dict) -> dict:
    s = (cfg.get('image', {}) or {}).get('local_flux', {}) or {}
    return {
        'model': s.get('model', 'Runpod/FLUX.2-klein-4B-mflux-4bit'),
        'quantize': (int(s['quantize']) if s.get('quantize') else 0),
        'low_ram': bool(s.get('low_ram', True)),
        'width': int(s.get('width', 1344)),
        'height': int(s.get('height', 768)),
        'steps': int(s.get('steps', 4)),
        'guidance': float(s.get('guidance', 1.0)),
        'base_seed': int(s.get('seed', 42)),
        'style_suffix': s.get('style_suffix', '').strip(),
        'series_characters_dir': s.get('series_characters_dir', ''),
        'lora_paths': list(s.get('lora_paths', []) or []),
        'lora_scales': [float(x) for x in (s.get('lora_scales', []) or [])],
        'extra_args': list(s.get('extra_args', []) or []),
        'max_refs_per_scene': int(s.get('max_refs_per_scene', 4)),
    }


def which_or_die(name: str) -> str:
    p = shutil.which(name)
    if not p:
        raise SystemExit(f'{name} not found on PATH. Install mflux: uv tool install --upgrade mflux --with hf_transfer')
    return p


def load_character_bible(chars_dir: Path) -> dict[str, Path]:
    """Return key -> portrait_path for every character with an on-disk portrait."""
    out = {}
    if not chars_dir or not chars_dir.exists():
        return out
    manifest_path = chars_dir / 'manifest.json'
    if manifest_path.exists():
        try:
            data = json.loads(manifest_path.read_text(encoding='utf-8'))
            for k, c in (data.get('characters') or {}).items():
                p = Path(c.get('portrait_path') or (chars_dir / f'{k}.png'))
                if p.exists() and p.stat().st_size > MIN_REAL_BYTES:
                    out[k] = p
        except Exception:
            pass
    # Also fall back: any *.png in the dir whose stem isn't already in manifest.
    for p in chars_dir.glob('*.png'):
        if p.stem not in out and p.stat().st_size > MIN_REAL_BYTES:
            out[p.stem] = p
    return out


def write_manifest(manifest_path: Path, by_id: dict[int, dict]):
    out = {
        'note': 'Local FLUX.2 klein-4B via mflux. Characters from series bible; scenes without characters use text-to-image.',
        'scenes': [by_id[k] for k in sorted(by_id)],
    }
    tmp = manifest_path.with_suffix('.json.tmp')
    tmp.write_text(json.dumps(out, indent=2), encoding='utf-8')
    tmp.replace(manifest_path)


def build_prompt(scene: dict, style_suffix: str) -> str:
    base = scene.get('image_prompt') or scene.get('prompt') or scene.get('title') or f"Scene {scene.get('scene_id')}"
    if style_suffix and style_suffix.lower() not in base.lower():
        return f'{base.rstrip(" .|,")} | {style_suffix}'
    return base


def common_flags(settings: dict, *, seed: int, output: Path) -> list[str]:
    flags = [
        '--model', settings['model'],
        '--width', str(settings['width']),
        '--height', str(settings['height']),
        '--steps', str(settings['steps']),
        '--guidance', str(settings['guidance']),
        '--seed', str(seed),
        '--output', str(output),
    ]
    if settings['quantize']:
        flags.extend(['-q', str(settings['quantize'])])
    if settings['low_ram']:
        flags.append('--low-ram')
    if settings['lora_paths']:
        flags.append('--lora-paths'); flags.extend(settings['lora_paths'])
        if settings['lora_scales']:
            flags.append('--lora-scales'); flags.extend(str(s) for s in settings['lora_scales'])
    flags.extend(settings['extra_args'])
    return flags


def run_mflux(cmd: list[str], log_path: Path) -> tuple[bool, str]:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open('a', encoding='utf-8') as log:
        log.write('\n+ ' + ' '.join(cmd) + '\n')
        log.flush()
        proc = subprocess.run(cmd, stdout=log, stderr=subprocess.STDOUT, text=True)
    if proc.returncode == 0:
        return True, ''
    tail = log_path.read_text(encoding='utf-8', errors='replace').splitlines()[-30:]
    return False, '\n'.join(tail)


def resolve_scene_refs(scene: dict, bible: dict[str, Path], max_refs: int) -> list[Path]:
    keys = scene.get('characters_in_scene') or []
    refs = []
    for k in keys:
        if k in bible:
            refs.append(bible[k])
            if len(refs) >= max_refs:
                break
        # else: silently skip unknown character keys (logged once per scene by caller)
    return refs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--project', required=True)
    ap.add_argument('--start', type=int, default=1)
    ap.add_argument('--limit', type=int, default=0, help='0 = all scenes')
    ap.add_argument('--scenes', type=int, nargs='*', help='only generate these scene ids')
    ap.add_argument('--force', action='store_true')
    args = ap.parse_args()

    project = Path(args.project).resolve()
    images = project / 'images'; images.mkdir(parents=True, exist_ok=True)
    log_path = project / 'logs' / 'images_local.log'
    manifest_path = images / 'manifest.json'

    cfg = load_config(project)
    settings = local_flux_settings(cfg)

    txt2img = which_or_die('mflux-generate-flux2')
    edit = which_or_die('mflux-generate-flux2-edit')

    chars_dir = Path(settings['series_characters_dir']).resolve() if settings['series_characters_dir'] else None
    bible = load_character_bible(chars_dir) if chars_dir else {}
    if chars_dir:
        print(f'character bible: {len(bible)} characters from {chars_dir}', flush=True)
        for k, p in sorted(bible.items()):
            print(f'  - {k} -> {p.name}', flush=True)
    else:
        print('warning: no series_characters_dir set — all scenes will be text-to-image', flush=True)

    scenes_data = json.loads((project / 'scenes.json').read_text(encoding='utf-8'))
    scenes = scenes_data.get('scenes', scenes_data if isinstance(scenes_data, list) else [])
    by_scene_id = {int(s['scene_id']): s for s in scenes}

    if args.scenes:
        selected_ids = sorted(set(args.scenes))
    else:
        selected_ids = sorted(sid for sid in by_scene_id if sid >= args.start)
        if args.limit:
            selected_ids = selected_ids[:args.limit]

    by_id: dict[int, dict] = {}
    if manifest_path.exists():
        try:
            for e in json.loads(manifest_path.read_text(encoding='utf-8')).get('scenes', []):
                if 'scene_id' in e:
                    by_id[int(e['scene_id'])] = e
        except Exception:
            pass

    ok = failed = skipped = 0
    for sid in selected_ids:
        scene = by_scene_id.get(sid)
        if not scene:
            print(f'  scene {sid} missing in scenes.json, skipping', flush=True)
            continue
        out = images / f'scene_{sid:04d}.png'
        if out.exists() and out.stat().st_size > MIN_REAL_BYTES and not args.force:
            by_id[sid] = {'scene_id': sid, 'output_path': str(out), 'status': 'exists',
                          'model': settings['model'], 'backend': 'local_flux',
                          'bytes': out.stat().st_size}
            write_manifest(manifest_path, by_id)
            skipped += 1
            print(f'  scene {sid:04d}: exists, skipped', flush=True)
            continue

        prompt = build_prompt(scene, settings['style_suffix'])
        seed = settings['base_seed'] + sid
        refs = resolve_scene_refs(scene, bible, settings['max_refs_per_scene'])
        requested_keys = scene.get('characters_in_scene') or []
        missing_keys = [k for k in requested_keys if k not in bible]
        if missing_keys:
            print(f'  scene {sid:04d}: warning — missing portraits for {missing_keys}', flush=True)

        if refs:
            cmd = [edit, '--prompt', prompt, '--image-paths'] + [str(r) for r in refs] + common_flags(settings, seed=seed, output=out)
            mode = f'edit-with-{len(refs)}-refs'
        else:
            cmd = [txt2img, '--prompt', prompt] + common_flags(settings, seed=seed, output=out)
            mode = 'text-to-image'

        t0 = time.time()
        success, tail = run_mflux(cmd, log_path)
        dt = time.time() - t0

        if success and out.exists() and out.stat().st_size > MIN_REAL_BYTES:
            by_id[sid] = {
                'scene_id': sid, 'output_path': str(out), 'status': 'generated',
                'model': settings['model'], 'backend': 'local_flux',
                'bytes': out.stat().st_size, 'mode': mode, 'seconds': round(dt, 1),
                'character_refs': [r.name for r in refs],
                'prompt_used': prompt,
            }
            write_manifest(manifest_path, by_id)
            ok += 1
            print(f'  scene {sid:04d}: ok ({dt:.0f}s, {mode}, refs={[r.stem for r in refs]})', flush=True)
        else:
            err = tail or ('output missing/small' if success else 'mflux non-zero')
            by_id[sid] = {
                'scene_id': sid, 'output_path': str(out), 'status': 'failed',
                'model': settings['model'], 'backend': 'local_flux',
                'mode': mode, 'seconds': round(dt, 1), 'error': err[-1200:],
            }
            write_manifest(manifest_path, by_id)
            failed += 1
            print(f'  scene {sid:04d}: FAILED ({dt:.0f}s) — see {log_path}', flush=True)

    print(f'\ndone: ok={ok} skipped={skipped} failed={failed}; manifest={manifest_path}', flush=True)
    if failed:
        sys.exit(2)


if __name__ == '__main__':
    main()
