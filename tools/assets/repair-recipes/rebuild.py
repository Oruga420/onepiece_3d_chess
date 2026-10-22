"""Replay five frozen, offline rig repairs into a NEW staging directory.

--check is read-only and runs with ordinary Python. Rebuilding requires Blender.
This script never adopts assets, changes the manifest, or deploys anything.
"""
import argparse
import hashlib
import importlib.util
import json
import subprocess
import sys
from pathlib import Path


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main():
    package = Path(__file__).resolve().parent
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo-root', type=Path, default=package.parents[2])
    parser.add_argument('--ids', help='Comma-separated recipe IDs; default: all five')
    parser.add_argument('--check', action='store_true', help='Validate inputs without writes or Blender')
    parser.add_argument('--out', type=Path, help='A new directory beneath the repository .local/')
    args = parser.parse_args(argv)
    root = args.repo_root.resolve()
    manifest = json.loads((package / 'recipes.json').read_text(encoding='utf-8'))
    ids = args.ids.split(',') if args.ids else list(manifest['recipes'])
    if not ids or len(set(ids)) != len(ids) or any(i not in manifest['recipes'] for i in ids):
        parser.error('Select unique IDs present in recipes.json')
    if not args.check and args.out is None:
        parser.error('Use --check, or explicitly name a NEW --out staging directory')
    for name, expected in manifest['generatorSha256'].items():
        if digest((root / name).read_bytes().replace(b'\r\n', b'\n')) != expected:
            raise ValueError(f'Generator changed: {name}. Review and refresh its recipe pin first.')
    if digest((package / 'skin.py').read_bytes().replace(b'\r\n', b'\n')) != manifest['solverSha256']:
        raise ValueError('Frozen recipe solver changed')
    props = json.loads((root / 'tools/assets/prop_bindings.json').read_text(encoding='utf-8'))
    originals = {}
    for ident in ids:
        recipe = manifest['recipes'][ident]
        selected_props = props.get(ident, {})
        canonical = json.dumps(selected_props, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()
        if digest(canonical) != recipe['propsSha256']:
            raise ValueError(f'Prop recipe changed: {ident}')
        spec = f"{manifest['sourceCommit']}:assets/models/{ident}.glb"
        data = subprocess.run(['git', '-C', str(root), 'cat-file', 'blob', spec],
                              check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout
        if data[:4] != b'glTF' or digest(data) != recipe['sourceSha256']:
            raise ValueError(f'Original source mismatch: {ident}')
        originals[ident] = data
    print(json.dumps({'preflight': 'passed', 'ids': ids, 'readOnly': args.check}), flush=True)
    if args.check:
        return

    import bpy
    if tuple(bpy.app.version) != tuple(manifest['blenderVersion']):
        raise ValueError(f"Use Blender {manifest['blenderVersion']} for this frozen recipe")
    out = (root / args.out).resolve()
    local = (root / '.local').resolve()
    if out == local or not out.is_relative_to(local) or out.exists():
        raise ValueError('--out must be a NEW directory beneath this repository .local/')
    source_root = out / 'input'
    for ident, data in originals.items():
        source = source_root / 'assets/models' / (ident + '.glb')
        source.parent.mkdir(parents=True, exist_ok=True)
        source.write_bytes(data)
    sys.path.insert(0, str(root / 'tools/assets'))
    import rig_characters as rig
    from restore_rig_surface import restore
    spec = importlib.util.spec_from_file_location('frozen_repair_skin', package / 'skin.py')
    skin = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(skin)
    rig.ROOT, rig.OUT = source_root, out / 'raw'
    rig.HandContact.finish = skin.solve
    report = {'sourceCommit': manifest['sourceCommit'], 'visualApproval': False, 'characters': []}
    for ident in ids:
        recipe = manifest['recipes'][ident]
        rig.FITS[ident] = recipe['fit']
        rig.PROP_BINDINGS[ident] = props.get(ident, {})
        rig.rig(ident, render=False)
        raw = out / 'raw/candidates' / (ident + '.glb')
        candidate = out / 'candidates' / (ident + '.glb')
        restore(raw, source_root / 'assets/models' / (ident + '.glb'), candidate)
        restoration = json.loads(candidate.with_suffix('.restore.json').read_text())
        metadata = json.loads((out / 'raw/reviews' / ident / 'metrics.json').read_text())
        metadata.update(sha256=digest(candidate.read_bytes()), bytes=candidate.stat().st_size,
                        surfaceRestoration=restoration)
        target = out / 'reviews' / ident / 'metrics.json'
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(metadata, indent=2), encoding='utf-8')
        report['characters'].append({'id': ident, 'sha256': metadata['sha256'],
                                     'matchesReferenceBytes': metadata['sha256'] == recipe['referenceRestoredSha256']})
        (out / 'run.json').write_text(json.dumps(report, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
