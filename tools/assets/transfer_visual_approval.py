"""Prove exact visual equivalence without rewriting or adopting an old approval.

Requires the existing local Pillow installation. No provider calls or browser.
Example:
 python tools/assets/transfer_visual_approval.py --old-review old/review.json \
   --new-review new/review.json --approval qa/old-odd.json --approval qa/old-even.json \
   --old-assets old/candidates --new-assets new/candidates --project-root . \
   --runtime-root . --output .local/equivalence.json

Only records with all ten decoded PNGs identical, identical actual asset bytes,
and a matching original pass are eligible. This report is evidence, not adoption.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path
import re
import struct
import warnings

from PIL import Image


RUNTIME_V2_FILES = (
    'src/skeletal-combat.mjs', 'src/combat.mjs', 'src/renderer.mjs',
    'src/attack-effects.mjs', 'src/attacks.mjs',
)
POSE_KEYS = {(pose, view) for pose in ('rest', 'guard', 'attack', 'defend', 'stress')
             for view in ('front', 'side')}


def require(value, message):
    if not value:
        raise ValueError(message)


def digest(value):
    return hashlib.sha256(value).hexdigest()


def valid_sha(value):
    return isinstance(value, str) and re.fullmatch(r'[0-9a-f]{64}', value) is not None


def read_json(path):
    path = Path(path).resolve()
    raw = path.read_bytes()
    return json.loads(raw), {'path': str(path), 'sha256': digest(raw)}


def runtime_fingerprint(root):
    files = [{'path': name, 'sha256': digest((Path(root) / name).read_bytes())}
             for name in RUNTIME_V2_FILES]
    return {'version': 2, 'hash': digest(':'.join(x['sha256'] for x in files).encode()),
            'files': files}


def review_runtime(review, new=False):
    version = review.get('runtimeFingerprintVersion', 1)
    require(version in (1, 2), 'Unknown runtime fingerprint version')
    require(valid_sha(review.get('runtimeHash')), 'Invalid review runtime hash')
    require(review.get('servedRuntimeHash') == review['runtimeHash'], 'Served/reported runtime mismatch')
    require(review.get('passed') is True and review.get('errors') == []
            and review.get('phase') == 'complete', 'Review capture is incomplete or failed')
    expected = list(RUNTIME_V2_FILES if version == 2 else RUNTIME_V2_FILES[:-1])
    if version == 2 or 'runtimeFiles' in review:
        require(review.get('runtimeFiles') == expected, 'Unexpected runtime fingerprint files')
    if new:
        require(version == 2, 'New review requires fingerprint v2 including attacks.mjs')
    return {'version': version, 'hash': review['runtimeHash'], 'files': expected,
            'filesInferredFromLegacySchema': 'runtimeFiles' not in review}


def indexed_characters(document):
    require(isinstance(document.get('characters'), list), 'Missing character records')
    result = {}
    for character in document['characters']:
        ident = character.get('id')
        require(isinstance(ident, str) and re.fullmatch(r'[a-z0-9_-]+/[a-z0-9_-]+', ident), 'Invalid character ID')
        require(ident not in result, 'Duplicate character ID: ' + ident)
        result[ident] = character
    return result


def safe_pose_file(directory, filename):
    require(isinstance(filename, str) and filename.lower().endswith('.png'), 'Pose must reference a PNG')
    directory = Path(directory).resolve()
    candidate = (directory / filename).resolve()
    require(candidate.is_relative_to(directory), 'Pose escapes its review directory')
    return candidate


def pose_map(character, directory):
    poses = character.get('poses')
    require(isinstance(poses, list) and len(poses) == 10, 'Exactly ten poses are required')
    result = {}
    for pose in poses:
        key = (pose.get('pose'), pose.get('view'))
        require(key in POSE_KEYS and key not in result, 'Unknown or duplicate pose')
        require(pose.get('metrics', {}).get('active') is True, 'Pose has no active skeleton')
        result[key] = (safe_pose_file(directory, pose.get('file')), pose.get('scenario'))
    require(set(result) == POSE_KEYS, 'Missing required pose')
    require(len({path for path, _ in result.values()}) == 10, 'Pose files must be distinct')
    return result


def png_pixels(path):
    raw = Path(path).read_bytes()
    require(raw[:8] == b'\x89PNG\r\n\x1a\n' and len(raw) >= 33
            and raw[12:16] == b'IHDR', 'Invalid PNG: ' + str(path))
    require(raw[24] == 8, 'Only lossless 8-bit review PNGs are supported')
    with warnings.catch_warnings():
        warnings.simplefilter('error', Image.DecompressionBombWarning)
        with Image.open(io.BytesIO(raw)) as image:
            require(image.format == 'PNG' and getattr(image, 'n_frames', 1) == 1, 'Expected a single PNG frame')
            require(image.mode in ('RGB', 'RGBA', 'L', 'LA', 'P'), 'Unsupported PNG mode')
            image.load()
            # Exact RGBA values plus interpretation metadata; no resizing,
            # perceptual threshold, color conversion profile or alpha masking.
            color = {key: digest(value) if isinstance(value, bytes) else value
                     for key in ('icc_profile', 'gamma', 'srgb')
                     if (value := image.info.get(key)) is not None}
            pixels = image.convert('RGBA').tobytes()
            dimensions = list(image.size)
    return pixels, {'path': str(Path(path).resolve()), 'fileSha256': digest(raw),
                    'pixelSha256': digest(pixels), 'dimensions': dimensions,
                    'decodedMode': 'RGBA', 'colorInterpretation': color}


def transfer(old_review_path, new_review_path, approval_paths, old_assets,
             new_assets, project_root, runtime_root, ids=None):
    old, old_ref = read_json(old_review_path)
    new, new_ref = read_json(new_review_path)
    old_runtime, new_runtime = review_runtime(old), review_runtime(new, new=True)
    actual_runtime = runtime_fingerprint(runtime_root)
    require(actual_runtime['hash'] == new_runtime['hash'], 'New review does not match current v2 runtime')
    old_chars, new_chars = indexed_characters(old), indexed_characters(new)
    approvals, approval_refs = {}, []
    for approval_path in approval_paths:
        document, reference = read_json(approval_path)
        require(document.get('runtimeHash') == old_runtime['hash'], 'Original approval runtime mismatch')
        source_review = document.get('sourceMetadata', document.get('sourceReview'))
        require(isinstance(source_review, str), 'Approval must identify its original review')
        require((Path(project_root) / source_review).resolve() == Path(old_review_path).resolve(), 'Approval references a different review')
        approval_refs.append(reference)
        for ident, record in indexed_characters(document).items():
            require(ident not in approvals, 'Duplicate original approval: ' + ident)
            approvals[ident] = (record, reference)
    selected = sorted(ids if ids is not None else [ident for ident, (record, _) in approvals.items()
                      if record.get('verdict') == 'pass' and isinstance(record.get('score'), (int, float)) and record['score'] >= 90])
    require(selected and len(selected) == len(set(selected)), 'Empty or duplicate requested IDs')
    report = {'schemaVersion': 1, 'method': 'exact-decoded-RGBA-equivalence',
              'createdAt': datetime.now(timezone.utc).isoformat(), 'adopted': False,
              'scope': 'Only these ten rendered poses; no claim of continuous-animation or gameplay equivalence.',
              'oldReview': old_ref, 'newReview': new_ref, 'originalApprovalFiles': approval_refs,
              'oldRuntime': old_runtime, 'newRuntime': new_runtime,
              'verifiedNewRuntimeFiles': actual_runtime['files'], 'characters': []}
    for ident in selected:
        row = {'id': ident, 'approvalTransferEligible': False, 'poses': [], 'failures': [],
               'oldRuntime': old_runtime, 'newRuntime': new_runtime}
        try:
            require(ident in approvals and ident in old_chars and ident in new_chars, 'Character missing from approval or review')
            approval, reference = approvals[ident]
            row['originalApproval'] = {'file': reference, 'record': approval}
            require(approval.get('verdict') == 'pass' and isinstance(approval.get('score'), (int, float))
                    and 90 <= approval['score'] <= 100 and approval.get('category_match') is True, 'Original visual approval is not an eligible pass')
            require(approval.get('runtimeHash') == old_runtime['hash'], 'Character approval runtime mismatch')
            previous, current = old_chars[ident], new_chars[ident]
            expected = previous.get('sha256')
            row['recordedAssetHashes'] = {'oldReview': expected, 'newReview': current.get('sha256'),
                                          'originalApproval': approval.get('sha256')}
            require(valid_sha(expected) and current.get('sha256') == expected
                    and approval.get('sha256') == expected, 'Candidate SHA differs across reviews or approval')
            assets = [Path(old_assets) / (ident + '.glb'), Path(new_assets) / (ident + '.glb')]
            asset_bytes = [file.read_bytes() for file in assets]
            row['assets'] = [{'path': str(file.resolve()), 'sha256': digest(data)} for file, data in zip(assets, asset_bytes)]
            require(all(digest(data) == expected for data in asset_bytes) and asset_bytes[0] == asset_bytes[1], 'Actual candidate asset differs from recorded SHA')
            evidence = approval.get('evidence', approval.get('evidencepaths'))
            require(isinstance(evidence, list) and evidence, 'Original approval evidence missing')
            row['originalEvidence'] = [{'path': str((Path(project_root) / item).resolve()),
                                        'sha256': digest((Path(project_root) / item).read_bytes())} for item in evidence]
            old_poses = pose_map(previous, Path(old_review_path).parent)
            new_poses = pose_map(current, Path(new_review_path).parent)
            for key in sorted(POSE_KEYS):
                before, before_info = png_pixels(old_poses[key][0])
                after, after_info = png_pixels(new_poses[key][0])
                equal = (before == after and before_info['dimensions'] == after_info['dimensions']
                         and before_info['colorInterpretation'] == after_info['colorInterpretation'])
                row['poses'].append({'pose': key[0], 'view': key[1], 'old': before_info, 'new': after_info,
                                     'oldScenario': old_poses[key][1], 'newScenario': new_poses[key][1],
                                     'decodedPixelsExactlyEqual': equal})
                if not equal:
                    row['failures'].append('Decoded PNG differs: ' + '/'.join(key))
            if not row['failures']:
                row['approvalTransferEligible'] = True
                row['transferredApproval'] = {'id': ident, 'sha256': expected, 'runtimeHash': new_runtime['hash'],
                    'runtimeFingerprintVersion': 2, 'score': approval['score'], 'verdict': 'pass',
                    'category_match': True, 'approvalMethod': report['method'],
                    'reasoning': 'Original visual judgment transferred only after identical candidate bytes and all ten exact decoded pose comparisons.',
                    'evidence': [pose['new']['path'] for pose in row['poses']] + [reference['path']],
                    'originalRuntimeHash': old_runtime['hash'], 'originalApprovalFileSha256': reference['sha256']}
        except (ValueError, OSError, KeyError, TypeError, struct.error,
                Image.DecompressionBombError, Image.DecompressionBombWarning) as error:
            row['failures'].append(str(error))
        report['characters'].append(row)
    require(runtime_fingerprint(runtime_root) == actual_runtime, 'Runtime changed during comparison')
    references = [old_ref, new_ref, *approval_refs]
    for row in report['characters']:
        references.extend(row.get('assets', []))
        references.extend(row.get('originalEvidence', []))
        for pose in row['poses']:
            references.extend({'path': pose[side]['path'], 'sha256': pose[side]['fileSha256']}
                              for side in ('old', 'new'))
    for reference in references:
        require(digest(Path(reference['path']).read_bytes()) == reference['sha256'],
                'Evidence changed during comparison: ' + reference['path'])
    report['counts'] = {'requested': len(selected),
                        'eligible': sum(row['approvalTransferEligible'] for row in report['characters']),
                        'blocked': sum(not row['approvalTransferEligible'] for row in report['characters'])}
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('old-review', 'new-review', 'old-assets', 'new-assets', 'project-root', 'runtime-root', 'output'):
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--approval', type=Path, action='append', required=True)
    parser.add_argument('--ids', help='Comma-separated IDs; default is every original pass >=90')
    args = parser.parse_args()
    require(not args.output.exists(), 'Report already exists; use a fresh output path')
    result = transfer(args.old_review, args.new_review, args.approval, args.old_assets,
                      args.new_assets, args.project_root, args.runtime_root,
                      args.ids.split(',') if args.ids else None)
    for row in result['characters']:
        if row['approvalTransferEligible']:
            row['transferredApproval']['equivalenceReport'] = str(args.output.resolve())
            row['transferredApproval']['evidence'].append(str(args.output.resolve()))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open('x', encoding='utf-8') as stream:
        json.dump(result, stream, indent=2)
        stream.write('\n')
    print(json.dumps({'report': str(args.output.resolve()), **result['counts']}))
    return 1 if result['counts']['blocked'] else 0


if __name__ == '__main__':
    raise SystemExit(main())
