"""Cost guard regressions; no provider requests."""
import tempfile
import unittest
from pathlib import Path
import generate
from datetime import datetime, timezone

class BudgetTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old = generate.LEDGER
        self.old_deadline = generate.HARD_DEADLINE
        generate.LEDGER = Path(self.temp.name) / 'ledger.json'
        generate.HARD_DEADLINE = datetime(2100, 1, 1, tzinfo=timezone.utc)
    def tearDown(self):
        generate.LEDGER = self.old
        generate.HARD_DEADLINE = self.old_deadline
        self.temp.cleanup()
    def test_reservation_is_durable_before_network(self):
        ledger = {'operations': {}}
        operation = generate.reserve(ledger, 'mugiwara/king', 'model', .30, 15)
        self.assertEqual(generate.read(generate.LEDGER)['operations']['mugiwara/king:model'], operation)
        self.assertIsNone(operation['taskId'])
        with self.assertRaises(RuntimeError):generate.reserve(ledger, 'mugiwara/king', 'model', .30, 15)
    def test_allocated_voice_budget_cannot_be_spent(self):
        ledger = {'operations': {'previous': {'reservedUSD': 26.35, 'state': 'downloaded'}}}
        with self.assertRaises(RuntimeError):generate.reserve(ledger, 'slot', 'image', .10)
    def test_eight_outstanding_tasks_cap(self):
        ledger = {'operations': {str(i): {'reservedUSD': .1, 'state': 'reserved-before-post'} for i in range(8)}}
        with self.assertRaises(RuntimeError):generate.reserve(ledger, 'slot', 'image', .10)
    def test_credits_cap_even_when_dollars_remain(self):
        ledger = {'operations': {'previous': {'reservedUSD': 0, 'credits': 990, 'state': 'downloaded'}}}
        with self.assertRaises(RuntimeError):generate.reserve(ledger, 'slot', 'model', .30, 15)
    def test_global_deadline_stops_new_spend(self):
        old = generate.HARD_DEADLINE
        try:
            generate.HARD_DEADLINE = datetime(2000, 1, 1, tzinfo=timezone.utc)
            with self.assertRaises(RuntimeError):generate.reserve({'operations': {}}, 'slot', 'image', .10)
        finally:generate.HARD_DEADLINE = old

    def test_expired_success_is_consumed_and_not_an_outstanding_task(self):
        ledger = {'operations': {'whitebeard/knight:image': {
            'reservedUSD': .1, 'state': 'starting', 'taskId': 'existing-id'}}}
        result = {'id': 'existing-id', 'status': 'succeeded', 'output': None,
                  'data_removed': True, 'completed_at': '2026-10-13T04:05:04Z'}
        generate.record_expired_image(ledger, 'whitebeard/knight', result)
        operation = ledger['operations']['whitebeard/knight:image']
        self.assertEqual(operation['state'], 'expired-data-removed')
        self.assertEqual(operation['taskId'], 'existing-id')
        self.assertEqual(operation['actualUSD'], .067)
        self.assertEqual(operation['reservedUSD'], .067)
        self.assertTrue(operation['dataRemoved'])

    def test_expiry_must_be_confirmed_by_provider(self):
        ledger = {'operations': {'whitebeard/knight:image': {
            'reservedUSD': .1, 'state': 'starting', 'taskId': 'existing-id'}}}
        with self.assertRaises(RuntimeError):
            generate.record_expired_image(ledger, 'whitebeard/knight', {
                'id': 'existing-id', 'status': 'succeeded', 'output': None,
                'data_removed': False})

    def test_single_recovery_keeps_original_and_cannot_repeat(self):
        ledger = {'operations': {'whitebeard/knight:image': {
            'reservedUSD': .067, 'actualUSD': .067,
            'state': 'expired-data-removed', 'taskId': 'existing-id'}}}
        generate.reserve_recovery(ledger, 'whitebeard/knight')
        self.assertIn('whitebeard/knight:image', ledger['operations'])
        self.assertIn('whitebeard/knight:image-recovery-1', ledger['operations'])
        with self.assertRaises(RuntimeError):
            generate.reserve_recovery(ledger, 'whitebeard/knight')

    def test_recovery_cannot_expand_approved_slots(self):
        with self.assertRaises(RuntimeError):
            generate.reserve_recovery({'operations': {}}, 'mugiwara/king')

if __name__ == '__main__':unittest.main()
