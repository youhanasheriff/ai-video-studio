#!/usr/bin/env python3
"""Generate scene images with Google GenAI image APIs.

Default backend: Imagen 4 Fast (models/imagen-4.0-fast-generate-001:predict),
which is Google's low-cost image generation endpoint relative to standard/ultra.
Also supports Gemini image models (generateContent) if GOOGLE_IMAGE_BACKEND=gemini.
"""
from __future__ import annotations
import argparse, base64, json, os, sys, time, urllib.request, urllib.error
from pathlib import Path


def load_dotenv():
    for path in [Path.home()/'.hermes'/'.env', Path('.env')]:
        if not path.exists():
            continue
        for raw in path.read_text(errors='ignore').splitlines():
            line=raw.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            k,v=line.split('=',1)
            k=k.strip(); v=v.strip().strip('"').strip("'")
            if k and k not in os.environ:
                os.environ[k]=v


def api_key():
    load_dotenv()
    key=os.getenv('GOOGLE_API_KEY') or os.getenv('GEMINI_API_KEY')
    if not key:
        raise SystemExit('Missing GOOGLE_API_KEY or GEMINI_API_KEY. Put it in ~/.hermes/.env or environment.')
    return key


def post_json(url, payload, key, timeout=120):
    data=json.dumps(payload).encode('utf-8')
    req=urllib.request.Request(url, data=data, headers={'Content-Type':'application/json','X-goog-api-key':key})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        body=e.read().decode('utf-8', errors='replace')
        raise RuntimeError(f'HTTP {e.code}: {body[:1000]}')


def generate_imagen(prompt, key, model, aspect_ratio='16:9'):
    url=f'https://generativelanguage.googleapis.com/v1beta/models/{model}:predict'
    payload={
        'instances':[{'prompt':prompt}],
        'parameters':{
            'sampleCount':1,
            'aspectRatio':aspect_ratio,
            'outputMimeType':'image/png',
            'personGeneration':'allow_adult',
        }
    }
    resp=post_json(url,payload,key)
    preds=resp.get('predictions') or []
    if not preds:
        raise RuntimeError('No predictions in Imagen response')
    b64=preds[0].get('bytesBase64Encoded') or preds[0].get('image',{}).get('bytesBase64Encoded')
    if not b64:
        raise RuntimeError('No image bytes in Imagen response: '+json.dumps(resp)[:500])
    return base64.b64decode(b64)


def generate_gemini(prompt, key, model):
    url=f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent'
    payload={
        'contents':[{'parts':[{'text':prompt}]}],
        'generationConfig':{'responseModalities':['TEXT','IMAGE']},
    }
    resp=post_json(url,payload,key)
    for cand in resp.get('candidates',[]):
        for part in cand.get('content',{}).get('parts',[]):
            inline=part.get('inlineData') or part.get('inline_data')
            if inline and inline.get('data'):
                return base64.b64decode(inline['data'])
    raise RuntimeError('No inline image data in Gemini response: '+json.dumps(resp)[:500])


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--project', required=True)
    ap.add_argument('--limit', type=int, default=0, help='0 = all scenes')
    ap.add_argument('--start', type=int, default=1)
    ap.add_argument('--force', action='store_true')
    ap.add_argument('--backend', default=os.getenv('GOOGLE_IMAGE_BACKEND','imagen'), choices=['imagen','gemini'])
    ap.add_argument('--model', default=os.getenv('GOOGLE_IMAGE_MODEL',''))
    ap.add_argument('--sleep', type=float, default=1.0)
    args=ap.parse_args()
    project=Path(args.project).resolve()
    scenes_path=project/'scenes.json'
    data=json.loads(scenes_path.read_text())
    scenes=data.get('scenes', data if isinstance(data,list) else [])
    key=api_key()
    model=args.model or ('imagen-4.0-fast-generate-001' if args.backend=='imagen' else 'gemini-2.5-flash-image')
    outdir=project/'images'; outdir.mkdir(parents=True, exist_ok=True)
    selected=[s for s in scenes if int(s.get('scene_id',0))>=args.start]
    if args.limit: selected=selected[:args.limit]
    manifest=[]
    for s in selected:
        sid=int(s['scene_id']); out=outdir/f'scene_{sid:04d}.png'
        prompt=s.get('image_prompt') or s.get('prompt') or s.get('title') or f'Scene {sid}'
        if out.exists() and out.stat().st_size>0 and not args.force:
            manifest.append({'scene_id':sid,'output_path':str(out),'status':'exists','model':model,'backend':args.backend})
            continue
        try:
            if args.backend=='imagen': img=generate_imagen(prompt,key,model)
            else: img=generate_gemini(prompt,key,model)
            out.write_bytes(img)
            manifest.append({'scene_id':sid,'output_path':str(out),'status':'generated','model':model,'backend':args.backend,'bytes':len(img)})
            print(f'generated scene {sid:04d}: {out}')
        except Exception as e:
            manifest.append({'scene_id':sid,'output_path':str(out),'status':'failed','model':model,'backend':args.backend,'error':str(e)[:1200]})
            print(f'FAILED scene {sid:04d}: {e}', file=sys.stderr)
        time.sleep(args.sleep)
    # merge with previous if any
    manifest_path=outdir/'manifest.json'
    old=[]
    if manifest_path.exists():
        try:
            prev=json.loads(manifest_path.read_text())
            old=prev.get('scenes', prev if isinstance(prev,list) else [])
        except Exception: old=[]
    byid={int(x.get('scene_id',-1)):x for x in old if 'scene_id' in x}
    for x in manifest: byid[int(x['scene_id'])]=x
    final={'note':'Google image generation manifest. Backend defaults to Imagen 4 Fast for lowest-cost Google image generation.', 'scenes':[byid[k] for k in sorted(byid)]}
    manifest_path.write_text(json.dumps(final, indent=2), encoding='utf-8')
    failed=[x for x in final['scenes'] if x.get('status')=='failed']
    print(f'manifest: {manifest_path}; failed={len(failed)}')
    if failed: sys.exit(2)

if __name__=='__main__': main()
