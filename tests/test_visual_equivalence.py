"""Offline fail-closed tests; run python tests/test_visual_equivalence.py."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

from PIL import Image, PngImagePlugin

spec = importlib.util.spec_from_file_location('visual_equivalence', Path(__file__).resolve().parents[1] / 'tools/assets/transfer_visual_approval.py')
tool = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool)


class VisualEquivalenceTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.old = self.root / 'old/review.json'
        self.new = self.root / 'new/review.json'
        for name in tool.RUNTIME_V2_FILES:
            file = self.root / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text('runtime fixture: ' + name)
        runtime = tool.runtime_fingerprint(self.root)
        self.asset = b'glTF test candidate bytes'
        self.sha = tool.digest(self.asset)
        for directory in ('old-assets', 'new-assets'):
            file = self.root / directory / 'crew/king.glb'
            file.parent.mkdir(parents=True)
            file.write_bytes(self.asset)
        records = []
        for directory in (self.old.parent, self.new.parent):
            directory.mkdir()
            poses = []
            for pose, view in sorted(tool.POSE_KEYS):
                file = f'crew-king-{pose}-{view}.png'
                image = Image.new('RGBA', (4, 5), (20, 80, 130, 255))
                metadata = PngImagePlugin.PngInfo()
                metadata.add_text('fixture', directory.name)
                image.save(directory / file, pnginfo=metadata, compress_level=0 if directory == self.old.parent else 9)
                poses.append({'pose': pose, 'view': view, 'file': file, 'metrics': {'active': True}, 'scenario': None})
            records.append({'id': 'crew/king', 'sha256': self.sha, 'poses': poses})
        self.old_doc = {'characters': [records[0]], 'runtimeHash': 'a' * 64, 'servedRuntimeHash': 'a' * 64,
                        'passed': True, 'errors': [], 'phase': 'complete'}
        self.new_doc = {'characters': [records[1]], 'runtimeHash': runtime['hash'], 'servedRuntimeHash': runtime['hash'],
                        'runtimeFingerprintVersion': 2, 'runtimeFiles': list(tool.RUNTIME_V2_FILES),
                        'passed': True, 'errors': [], 'phase': 'complete'}
        self.approval = self.root / 'approval.json'
        self.approval_doc = {'sourceMetadata': 'old/review.json', 'runtimeHash': 'a' * 64,
                            'characters': [{'id': 'crew/king', 'sha256': self.sha, 'runtimeHash': 'a' * 64,
                                            'verdict': 'pass', 'score': 92, 'category_match': True,
                                            'reasoning': 'Original human review.', 'evidence': ['old/crew-king-rest-front.png']}]}
        self.save()

    def save(self):
        for path, document in ((self.old, self.old_doc), (self.new, self.new_doc), (self.approval, self.approval_doc)):
            path.write_text(json.dumps(document))

    def run_transfer(self):
        return tool.transfer(self.old, self.new, [self.approval], self.root / 'old-assets',
                             self.root / 'new-assets', self.root, self.root, ['crew/king'])

    def assert_blocked(self, report):
        self.assertEqual(report['counts'], {'requested': 1, 'eligible': 0, 'blocked': 1})
        self.assertNotIn('transferredApproval', report['characters'][0])

    def test_exact_decoded_pixels_allow_different_png_encoding_and_preserve_original_judgment(self):
        original = self.approval.read_bytes()
        result = self.run_transfer()
        self.assertEqual(result['counts']['eligible'], 1)
        row = result['characters'][0]
        self.assertEqual(len(row['poses']), 10)
        self.assertNotEqual(row['poses'][0]['old']['fileSha256'], row['poses'][0]['new']['fileSha256'])
        self.assertEqual(row['poses'][0]['old']['pixelSha256'], row['poses'][0]['new']['pixelSha256'])
        self.assertEqual(row['originalApproval']['record']['runtimeHash'], 'a' * 64)
        self.assertEqual(row['transferredApproval']['runtimeHash'], self.new_doc['runtimeHash'])
        self.assertEqual(row['transferredApproval']['score'], 92)
        self.assertEqual(self.approval.read_bytes(), original)
        self.assertFalse(result['adopted'])

    def test_one_changed_pixel_blocks_transfer(self):
        path = self.new.parent / 'crew-king-attack-front.png'
        with Image.open(path) as image:
            image = image.copy()
        image.putpixel((1, 1), (21, 80, 130, 255))
        image.save(path)
        report = self.run_transfer()
        self.assert_blocked(report)
        self.assertIn('Decoded PNG differs: attack/front', report['characters'][0]['failures'])

    def test_changed_asset_record_blocks_transfer_even_when_pngs_match(self):
        self.new_doc['characters'][0]['sha256'] = 'b' * 64
        self.save()
        self.assert_blocked(self.run_transfer())

    def test_actual_asset_mismatch_cannot_be_hidden_by_review_metadata(self):
        (self.root / 'new-assets/crew/king.glb').write_bytes(b'different actual asset')
        self.assert_blocked(self.run_transfer())

    def test_missing_pose_or_missing_png_blocks_transfer(self):
        original = copy.deepcopy(self.new_doc)
        self.new_doc['characters'][0]['poses'].pop()
        self.save()
        self.assert_blocked(self.run_transfer())
        self.new_doc = original
        self.save()
        (self.new.parent / 'crew-king-stress-side.png').unlink()
        self.assert_blocked(self.run_transfer())

    def test_original_revise_cannot_be_transferred(self):
        self.approval_doc['characters'][0]['verdict'] = 'revise'
        self.save()
        self.assert_blocked(self.run_transfer())

    def test_v2_must_include_attacks_and_match_current_files(self):
        self.new_doc['runtimeFiles'].pop()
        self.save()
        with self.assertRaisesRegex(ValueError, 'fingerprint files'):
            self.run_transfer()
        self.new_doc['runtimeFiles'] = list(tool.RUNTIME_V2_FILES)
        self.save()
        (self.root / 'src/attacks.mjs').write_text('changed attack family')
        with self.assertRaisesRegex(ValueError, 'current v2 runtime'):
            self.run_transfer()


if __name__ == '__main__':
    unittest.main()
