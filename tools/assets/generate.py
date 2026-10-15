"""Resumable bounded personal Nano Banana/Meshy asset generation. Never logs keys."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import time
from datetime import datetime, timezone
import requests

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / 'assets/models/manifest.json'
LEDGER = ROOT / 'docs/reports/assets-ledger.json'
HARD_DEADLINE = datetime.fromisoformat('2026-10-13T20:04:52+00:00')
TERMINAL_STATES = {'downloaded', 'failed', 'FAILED', 'canceled', 'expired-data-removed'}
RECOVERY_IDS = frozenset(['whitebeard/knight', 'whitebeard/pawn', 'marines/king',
    'marines/queen', 'marines/rook', 'marines/bishop', 'marines/knight', 'marines/pawn'])

def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, indent=2), encoding='utf8')
    os.replace(temporary, path)

def read(path):
    return json.loads(path.read_text(encoding='utf8'))

def keys():
    home = Path.home()
    config = read(home / '.claude.json')
    mesh = config['mcpServers']['meshy']['env']['MESHY_API_KEY']
    text = (home / '.env').read_text(encoding='utf8')
    token = re.search(r'^REPLICATE_API_TOKEN\s*=\s*(.+)$', text, re.M)[1].strip().strip('\"\'')
    return mesh, token

def uri(path):
    return 'data:image/png;base64,' + base64.b64encode(path.read_bytes()).decode()

def request(method, url, token, body=None):
    response = requests.request(method, url, headers={'Authorization': 'Bearer ' + token,
        'User-Agent': 'personal-onepiece-chess/1.0'}, json=body, timeout=45)
    if response.status_code >= 400:
        raise RuntimeError(f'Provider HTTP {response.status_code}; no automatic paid retry')
    return response.json()

def reserve(ledger, slot, stage, amount, credits=0):
    if datetime.now(timezone.utc) >= HARD_DEADLINE:
        raise RuntimeError('Global eight-hour deadline reached; only poll/download committed outputs')
    existing = ledger['operations'].get(slot + ':' + stage)
    if existing:
        raise RuntimeError('Existing reservation/task; reconcile it instead of duplicate POST')
    active = sum(v['state'] not in TERMINAL_STATES
                 for v in ledger['operations'].values())
    if active >= 8:
        raise RuntimeError('Eight-task concurrency cap; poll existing tasks first')
    committed = sum(v['reservedUSD'] for v in ledger['operations'].values())
    if committed + amount > 26.4 + 1e-8:
        raise RuntimeError('Asset allocation exhausted; voice/report allocation protected')
    if sum(v.get('credits', 0) for v in ledger['operations'].values()) + credits > ledger.get('meshCreditsCap', 990):
        raise RuntimeError('Meshy credit hard cap reached')
    operation = {'reservedUSD': amount, 'credits': credits, 'state': 'reserved-before-post',
                 'createdAt': time.time(), 'taskId': None}
    ledger['operations'][slot + ':' + stage] = operation
    save(LEDGER, ledger)
    return operation

def record_expired_image(ledger, identifier, result):
    operation = ledger['operations'][identifier + ':image']
    if (result.get('status') != 'succeeded' or result.get('output') is not None or
        result.get('data_removed') is not True or result.get('id') != operation['taskId']):
        raise RuntimeError('Image expiry not confirmed by original provider task')
    operation.setdefault('originalReservedUSD', operation['reservedUSD'])
    operation.update(state='expired-data-removed', actualUSD=.067, reservedUSD=.067,
        providerOutcome='succeeded', dataRemoved=True, confirmedAt=time.time(),
        completedAt=result.get('completed_at'))
    save(LEDGER, ledger)

def reserve_recovery(ledger, identifier):
    if identifier not in RECOVERY_IDS:
        raise RuntimeError('Reference recovery outside the eight authorized slots')
    previous = ledger['operations'].get(identifier + ':image')
    if not previous or previous['state'] != 'expired-data-removed':
        raise RuntimeError('Original consumed image must have confirmed expiry')
    operation = reserve(ledger, identifier, 'image-recovery-1', .10)
    operation['recoveryOfTaskId'] = previous['taskId']
    save(LEDGER, ledger)
    return operation

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['submit-images', 'recover-images', 'submit-models', 'poll', 'status', 'correct-cracker'])
    parser.add_argument('--ids', nargs='*', default=[])
    args = parser.parse_args()
    lock = LEDGER.with_suffix('.lock')
    lock.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    try:
        manifest = read(MANIFEST)
        ledger = read(LEDGER) if LEDGER.exists() else {'version': 1, 'allocationUSD': 26.4,
            'meshCreditValuationUSD': .02, 'operations': {}}
        if args.action == 'recover-images':
            if not args.ids or any(identifier not in RECOVERY_IDS for identifier in args.ids):
                raise RuntimeError('Specify only explicitly authorized eight recovery IDs')
            ledger['crashRecoveryAuthorization'] = {
                'reason': 'User explicitly continued after harness closure; root authorized exactly one recovery per final eight expired references.',
                'hardDeadlineUTC': HARD_DEADLINE.isoformat(),
                'previousHardDeadlineUTC': '2026-10-13T11:39:22.192013+00:00',
                'referenceRecoveryMaximumSettledUSD': .536,
                'forecastFinalSettledUSD': 25.125,
                'allowedIds': sorted(RECOVERY_IDS),
                'noAutomaticPaidRetry': True}
            save(LEDGER, ledger)
        if args.action == 'correct-cracker':
            if ledger.get('crackerCorrectionAuthorized'):
                raise RuntimeError('One correction already prepared; resume existing task')
            asset = next(a for a in manifest['assets'] if a['id']=='bigmom/rook')
            for stage in ['image','model']:
                ledger['operations']['bigmom/rook:rejected-'+stage] = ledger['operations'].pop('bigmom/rook:'+stage)
            for relative in ['assets/references/bigmom/rook.png','assets/models/bigmom/rook.glb','tools/assets/raw/bigmom/rook.glb']:
                original=ROOT/relative
                rejected=ROOT/'tools/assets/rejected'/relative
                rejected.parent.mkdir(parents=True,exist_ok=True)
                original.rename(rejected)
            old_reviews=ROOT/'tools/assets/reviews/bigmom/rook'
            archived_reviews=ROOT/'tools/assets/rejected/reviews/bigmom/rook'
            if not old_reviews.resolve().is_relative_to(ROOT.resolve()) or not archived_reviews.resolve().is_relative_to(ROOT.resolve()):
                raise RuntimeError('Rejected review archive path escaped workspace')
            archived_reviews.parent.mkdir(parents=True,exist_ok=True)
            old_reviews.rename(archived_reviews)
            asset['taskHistory']=[{'taskId':asset['taskId'],'referenceTaskId':asset['referenceTaskId'],
                'sha256':asset['sha256'],'status':'identity-rejected','reason':'Generic overcoat obscures canonical Cracker'}]
            asset.update(status='pending',review={'status':'identity-rejected'})
            ledger.update(meshCreditsCap=1005,crackerCorrectionAuthorized=True,
                correctionJustification='Leader authorized exactly one Cracker identity correction, <=USD0.367 settled, total<=26.4 asset allocation.')
            for operation in ledger['operations'].values():
                if operation.get('actualUSD') is not None:
                    operation.setdefault('originalReservedUSD',operation['reservedUSD'])
                    operation['reservedUSD']=operation['actualUSD']
            save(LEDGER,ledger);save(MANIFEST,manifest)
            print('Cracker correction prepared; rejected paid outputs preserved',flush=True)
            return
        mesh, replicate = keys()
        for asset in manifest['assets']:
            if args.ids and asset['id'] not in args.ids:
                continue
            identifier = asset['id']
            reference = ROOT / 'assets/references' / (identifier + '.png')
            if args.action in ['submit-images', 'recover-images']:
                recovery = args.action == 'recover-images'
                stage = 'image-recovery-1' if recovery else 'image'
                if reference.exists() or identifier + ':' + stage in ledger['operations']:
                    continue
                if recovery:
                    previous = ledger['operations'].get(identifier + ':image')
                    if not previous or not previous.get('taskId'):
                        raise RuntimeError('Original image task absent; no recovery POST')
                    if previous['state'] != 'expired-data-removed':
                        result = request('GET', 'https://api.replicate.com/v1/predictions/' + previous['taskId'], replicate)
                        record_expired_image(ledger, identifier, result)
                prompt = ('A single full-body recognizable ' + asset['name'] + ' from One Piece, '
                    'canonical anime character costume and distinctive face, high-quality stylized 3D game miniature. '
                    'Full head, all limbs and shoes entirely visible, relaxed standing action-ready pose, '
                    'three-quarter front view, solid white studio background, even neutral lighting, '
                    'no text, no logo, no flag, no platform, no other character, volumetric sculpted form. '
                    'Use reference only for colors where correct; the named character identity takes priority. '
                    'Keep accessories close to the body and separated readable silhouette.')
                if asset['name'] == 'Crew':
                    prompt += ' A generic adult male member of the ' + asset['crew'] + ' pirate crew, not its captain.'
                if asset['name'] in ['King', 'Queen'] and asset['crew'] == 'kaido':
                    prompt += ' This is the Beast Pirates commander named ' + asset['name'] + ', not a chess royal.'
                specifics = {'Bepo': 'A white polar bear mink wearing an orange Heart Pirates jumpsuit; absolutely not a submarine.',
                    'Chopper': 'A small brown reindeer doctor, blue nose, round pink hat with white X; not Usopp or a human.',
                    'Richie': 'A large golden lion with purple mane from the Buggy Pirates; quadruped animal, not a human.',
                    'Shachi': 'One single man, orange hair, sunglasses and white Heart Pirates jumpsuit.',
                    'Penguin': 'One single man wearing his penguin-shaped cap and white Heart Pirates jumpsuit.',
                    'Shark': 'A single rugged adult male Kid Pirates crew member, pirate clothing, not an actual fish.',
                    'Mohji': 'A single white-haired animal tamer man wearing his white fur vest and bear-ear hood; no lion beside him.'}
                prompt += ' ' + specifics.get(asset['name'], '')
                if asset['name']=='Cracker' and ledger.get('crackerCorrectionAuthorized'):
                    prompt = ('Charlotte Cracker from One Piece, his instantly recognizable BISCuit SOLDIER ARMOR form '
                        'shown in the supplied reference: huge broad muscular armored biscuit knight, ornate bronze biscuit '
                        'armor, orange/red beard and mustache, tall crested helmet, massive round biscuit shield and sword. '
                        'Single full-body stylized anime 3D game miniature, all legs shoes head visible, neutral standing pose, '
                        'white studio background, NO long overcoat, NO burgundy jacket, NO generic pirate, no effects or other figures. '
                        'Preserve the armor design of the reference and remove its surrounding effects.')
                operation = reserve_recovery(ledger, identifier) if recovery else reserve(ledger, identifier, 'image', .10)
                result = request('POST', 'https://api.replicate.com/v1/models/google/nano-banana-2/predictions',
                    replicate, {'input': {'prompt': prompt, 'resolution': '1K', 'aspect_ratio': '2:3',
                    'output_format': 'png', 'image_input': [uri(ROOT / asset['sourceImage'].lstrip('/'))],
                    'image_search': False, 'google_search': False}})
                operation.update(taskId=result['id'], state=result['status'], actualUSD=None)
                save(LEDGER, ledger)
                if recovery:
                    asset.setdefault('referenceTaskHistory', []).append({
                        'taskId': asset['referenceTaskId'], 'status': 'expired-data-removed',
                        'actualUSD': .067, 'dataRemoved': True})
                asset['referenceTaskId'] = result['id']
                asset['referencePrompt'] = prompt
                save(MANIFEST, manifest)
                print(identifier, 'image submitted', result['id'], flush=True)
            elif args.action == 'submit-models':
                if not reference.exists() or identifier + ':model' in ledger['operations']:
                    continue
                operation = reserve(ledger, identifier, 'model', .30, 15)
                result = request('POST', 'https://api.meshy.ai/openapi/v1/image-to-3d', mesh,
                    {'image_url': uri(reference), 'model_type': 'smart-topology', 'ai_model': 'meshy-t2',
                     'target_polycount': 10000, 'should_texture': True, 'texture_resolution': '2k',
                     'target_formats': ['glb']})
                operation.update(taskId=result['result'], state='PENDING')
                save(LEDGER, ledger)
                asset.update(taskId=result['result'], status='generating', credits=15,
                             referenceImage='/assets/references/' + identifier + '.png')
                save(MANIFEST, manifest)
                print(identifier, 'model submitted', result['result'], flush=True)
            elif args.action == 'poll':
                for stage in ['image', 'image-recovery-1', 'model']:
                    operation = ledger['operations'].get(identifier + ':' + stage)
                    if not operation or not operation['taskId'] or operation['state'] in TERMINAL_STATES:
                        continue
                    is_image = stage.startswith('image')
                    url = ('https://api.replicate.com/v1/predictions/' if is_image else
                           'https://api.meshy.ai/openapi/v1/image-to-3d/') + operation['taskId']
                    result = request('GET', url, replicate if is_image else mesh)
                    operation['state'] = result['status']
                    if result['status'] in ['succeeded', 'SUCCEEDED']:
                        output = result['output'] if is_image else result['model_urls']['glb']
                        if stage == 'image' and output is None and result.get('data_removed'):
                            record_expired_image(ledger, identifier, result)
                            print(identifier, stage, 'expired-data-removed; consumed cost preserved', flush=True)
                            continue
                        if output is None:
                            raise RuntimeError('Provider returned no output; no automatic paid retry')
                        if isinstance(output, list): output = output[0]
                        destination = reference if is_image else ROOT / 'tools/assets/raw' / (identifier + '.glb')
                        destination.parent.mkdir(parents=True, exist_ok=True)
                        response = requests.get(output, timeout=45)
                        response.raise_for_status()
                        temporary = destination.with_suffix(destination.suffix + '.tmp')
                        temporary.write_bytes(response.content)
                        os.replace(temporary, destination)
                        operation.update(state='downloaded', actualUSD=.067 if is_image else
                            result.get('consumed_credits', 15) * .02)
                        if stage == 'model':
                            asset.update(status='raw-ready', credits=result.get('consumed_credits', 15),
                                rawSha256=hashlib.sha256(response.content).hexdigest())
                        else: asset['referenceSha256'] = hashlib.sha256(response.content).hexdigest()
                    save(LEDGER, ledger)
                    save(MANIFEST, manifest)
                    print(identifier, stage, operation['state'], flush=True)
        print(json.dumps({'reservedUSD': round(sum(v['reservedUSD'] for v in ledger['operations'].values()), 4),
            'settledUSD': round(sum(v.get('actualUSD') or 0 for v in ledger['operations'].values()), 4),
            'meshCreditsReserved': sum(v.get('credits', 0) for v in ledger['operations'].values())}), flush=True)
    finally:
        os.close(descriptor)
        lock.unlink()

if __name__ == '__main__':
    main()
