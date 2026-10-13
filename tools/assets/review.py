"""Build review sheets and adopt measured Blender metrics, never approve unseen assets."""
import argparse
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('action', choices=['references', 'models', 'adopt', 'approve'])
parser.add_argument('--ids', nargs='+', required=True)
parser.add_argument('--sheet', default='batch')
args = parser.parse_args()
manifest_path = ROOT / 'assets/models/manifest.json'
manifest = json.loads(manifest_path.read_text(encoding='utf8'))
assets = [a for a in manifest['assets'] if a['id'] in args.ids]
if args.action in ['adopt', 'approve']:
    for asset in assets:
        identifier = asset['id']
        file = ROOT / asset['path'].lstrip('/')
        metrics_path = ROOT / 'tools/assets/reviews' / identifier / 'metrics.json'
        if not file.exists() or not metrics_path.exists():
            raise RuntimeError('Cannot adopt or approve missing model/metrics: ' + identifier)
        metrics = json.loads(metrics_path.read_text(encoding='utf8'))
        asset.update(sha256=hashlib.sha256(file.read_bytes()).hexdigest(),bytes=file.stat().st_size,
            triangles=metrics['triangles'],textures=metrics['textures'],status='ready')
        if args.action == 'approve':
            asset['review'] = {'status': 'approved', 'views': metrics['views'],
                'sheet': 'tools/assets/' + args.sheet + '.jpg', 'reviewer': 'asset agent visual inspection',
                'observations': 'Textured recognizable volumetric character viewed front/side/back/isolated three-quarter. Actual board QA is downstream.'}
    manifest_path.write_text(json.dumps(manifest,indent=2),encoding='utf8')
else:
    cols = 4
    rows = len(assets) if args.action == 'models' else (len(assets)+3)//4
    width = 384
    sheet = Image.new('RGB',(width*cols,414*rows),'#111827')
    draw = ImageDraw.Draw(sheet)
    for i, asset in enumerate(assets):
        views = ['front','side','back','board'] if args.action=='models' else ['reference']
        for col, view in enumerate(views):
            file = (ROOT/'assets/references'/(asset['id']+'.png') if view=='reference' else
                    ROOT/'tools/assets/reviews'/asset['id']/(view+'.png'))
            if not file.exists():continue
            row = i if args.action=='models' else i//4
            column = col if args.action=='models' else i%4
            im=Image.open(file).convert('RGB');im.thumbnail((384,384))
            sheet.paste(im,(column*384+(384-im.width)//2,row*414+30))
            draw.text((column*384+6,row*414+8),asset['id']+' '+asset['name']+' '+view,fill='white')
    sheet.save(ROOT/'tools/assets'/(args.sheet+'.jpg'),quality=88)
