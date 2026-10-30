"""All lifecycle actions are injected; real execute/start/provider/Docker are never called."""
import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
source = Path(__file__).resolve().parents[1] / 'week1-auth-rehearsal.py'
spec = importlib.util.spec_from_file_location('week1_auth_broker_under_test', source)
broker = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = broker
spec.loader.exec_module(broker)


def proposal():
    value = {'version': 1, 'target': {'root': broker.ROOT, 'database': broker.DATABASE, 'project': broker.PROJECT},
             'bounds': {'ownerApprovalStartSeconds': 600, 'maximumSeconds': 3600, 'cleanupReserveSeconds': 180},
             'explicitFakePolicy': {'notProductionDefaults': True}}
    value['scopeSha256'] = broker.scope_sha256(value)
    return value


def owner(p, digit='a', approved='2026-10-30T12:00:00.000000Z'):
    return {'messageId': 'Sentinel_' + digit * 32, 'approvedAt': approved, 'scopeSha256': p['scopeSha256']}


NOW = broker.owner_microseconds('2026-10-30T12:00:00Z') // 1000


class FakePort:
    def __init__(self, failure=None):
        self.events = []
        self.failure = failure
        self.cleanup_result = dict(providerRevoked=True, appDisabled=True, sqlDisabled=True, stopped=True, retained=True)

    def preflight(self, _):
        self.events.append('preflight')
        if self.failure == 'preflight':
            raise RuntimeError('fake denied')

    def reserve(self, _, control):
        self.events.append(('reserve', dict(control)))
        return 'fake-reservation'

    def arm_guard(self, _, control):
        self.events.append(('guard', control['deadline']))
        if self.failure == 'guard':
            raise RuntimeError('fake guardlost')

    def check_parent(self):
        if self.failure == 'parent':
            raise RuntimeError('fake parentlost')

    def journal(self, value):
        self.events.append(value)

    def phase(self, phase, _):
        self.events.append(phase)
        if phase == self.failure:
            raise RuntimeError('fake provider secret must not escape')

    def cleanup(self, _):
        self.events.append('cleanup')
        return self.cleanup_result


class BrokerSourceTests(unittest.TestCase):
    def test_fake_lifecycle_never_calls_real_execute_or_start(self):
        p = proposal()
        with patch.object(broker.LiveBroker, 'execute', side_effect=AssertionError('REAL EXECUTE FORBIDDEN')):
            fake = FakePort()
            result = broker.exercise_injected(fake, p, owner(p), lambda: NOW + 1, lambda: 50)
        self.assertTrue(result['assertionsPassed'])
        self.assertTrue(result['cleanupVerified'])
        self.assertFalse(result['runtimeReady'])
        self.assertEqual(fake.events[-1], 'cleanup')
        self.assertEqual(result['deadline'], NOW + 1 + 3600000)

    def test_every_partial_phase_and_parent_loss_cleans_without_claiming_success(self):
        for phase in ['guard', 'stage', 'stack', 'migrations', 'bootstrap', 'web', 'invitations', 'assert_http', 'parent']:
            with self.subTest(phase=phase):
                p = proposal()
                fake = FakePort(phase)
                result = broker.exercise_injected(fake, p, owner(p), lambda: NOW + 1, lambda: 50)
                self.assertFalse(result['assertionsPassed'])
                self.assertTrue(result['cleanupVerified'])
                self.assertEqual(fake.events[-1], 'cleanup')

    def test_preflight_failure_or_stale_admission_cannot_reserve(self):
        p = proposal()
        fake = FakePort('preflight')
        with self.assertRaises(RuntimeError):
            broker.exercise_injected(fake, p, owner(p), lambda: NOW + 1, lambda: 50)
        self.assertFalse(any(isinstance(v, tuple) and v[0] == 'reserve' for v in fake.events))
        fake = FakePort()
        with self.assertRaises(broker.ScopeError):
            broker.exercise_injected(fake, p, owner(p), lambda: NOW + 600001, lambda: 50)
        self.assertEqual(fake.events, [])

    def test_slow_preflight_rechecks_original_owner_time_not_receipt_creation(self):
        p = proposal()
        times = iter([NOW + 1, NOW + 600001])
        fake = FakePort()
        with self.assertRaises(broker.ScopeError):
            broker.exercise_injected(fake, p, owner(p), lambda: next(times), lambda: 50)
        self.assertEqual(fake.events, ['preflight'])

    def test_exact_fractional_utc_offset_is_preserved_and_checked_without_float_rounding(self):
        p = proposal()
        evidence = owner(p, 'b', '2026-10-30T12:00:00.000123+00:00')
        broker.admit(p, evidence, NOW + 1)
        self.assertEqual(evidence['approvedAt'], '2026-10-30T12:00:00.000123+00:00')
        self.assertEqual(broker.owner_microseconds(evidence['approvedAt']), NOW * 1000 + 123)
        with self.assertRaises(broker.ScopeError):
            broker.admit(p, evidence, NOW)
        with self.assertRaises(broker.ScopeError):
            broker.admit(p, evidence, NOW + 600001)

    def test_owner_id_cannot_be_rebound_and_closed_ids_never_reopen(self):
        p = proposal()
        evidence = owner(p, 'c')
        broker.admit(p, evidence, NOW + 1)
        with self.assertRaises(broker.ScopeError):
            broker.admit(p, {**evidence, 'approvedAt': '2026-10-30T12:00:00.001Z'}, NOW + 2)
        for message in broker.CLOSED_MESSAGES:
            with self.assertRaises(broker.ScopeError):
                broker.admit(p, {**evidence, 'messageId': message}, NOW + 1)

    def test_changed_policy_target_or_window_cannot_reuse_scope(self):
        p = proposal()
        for value in [{**p, 'explicitFakePolicy': {}}, {**p, 'target': {**p['target'], 'database': 'postgres'}},
                      {**p, 'bounds': {**p['bounds'], 'maximumSeconds': 3601}}]:
            with self.assertRaises(broker.ScopeError):
                broker.admit(value, owner(p), NOW + 1)

    def test_guard_uses_original_wall_monotonic_and_pid_ticks(self):
        control = {'cleanupAt': NOW + 3420000, 'monotonicDeadline': 3600100,
                   'parentPid': 20, 'parentTicks': '200', 'uid': 1000}
        live = lambda _: {'ticks': '200', 'uid': 1000}
        self.assertFalse(broker.guard_should_stop(control, NOW + 1, 101, live))
        self.assertTrue(broker.guard_should_stop(control, NOW + 3420000, 101, live))
        self.assertTrue(broker.guard_should_stop(control, NOW - 1000, 3420100, live))
        self.assertTrue(broker.guard_should_stop(control, NOW + 1, 101, lambda _: {'ticks': 'reused', 'uid': 1000}))

    def test_unverified_revocation_or_stop_cannot_be_called_cleanup_success(self):
        p = proposal()
        for key in ['providerRevoked', 'appDisabled', 'sqlDisabled', 'stopped', 'retained']:
            fake = FakePort()
            fake.cleanup_result[key] = False
            result = broker.exercise_injected(fake, p, owner(p), lambda: NOW + 1, lambda: 50)
            self.assertFalse(result['cleanupVerified'])

    def test_default_proposal_does_not_call_native_ports_or_claim_e2e(self):
        with patch.object(broker, 'private_read', side_effect=AssertionError('NO RUNTIME FS')), patch.object(broker.subprocess, 'Popen', side_effect=AssertionError('NO SUBPROCESS')):
            p = broker.proposal()
        self.assertFalse(p['runtimeReady'])
        self.assertTrue(p['learnersCreatedOnlyByInvitationActivation'])
        self.assertFalse(p['optional0021And0022Included'])

    def test_real_cleanup_sequencing_uses_only_fakes_and_still_stops_after_provider_failure(self):
        # Exercise cleanup, not execute/start. Every FS/process/Docker/provider
        # boundary used by this branch is replaced; no runtime path is opened.
        adapter = broker.LiveBroker.__new__(broker.LiveBroker)
        adapter.run = Path(broker.ROOT)
        adapter.env = {}
        adapter.now = lambda: NOW + 1000
        adapter.monotonic = lambda: 100
        adapter.read = lambda: {'deadline': NOW + 3600000, 'phases': [{'phase': 'bootstrap'}], 'uid': 1000}
        adapter.broker = lambda *_args, **_kw: (_ for _ in ()).throw(RuntimeError('fake provider inventory failure'))
        adapter.verify_owned_containers = lambda **_kw: [{'id': '1' * 64, 'running': True}]
        commands = []
        adapter.command = lambda args, **_kw: commands.append(args) or b''
        writes = []
        def exists(path):
            return path.name == 'auth-baseline.private.json'
        with patch.object(broker.os, 'open', return_value=99), patch.object(broker.os, 'close'), patch.object(broker.fcntl, 'flock'), patch.object(Path, 'exists', exists), patch.object(broker, 'private_write', side_effect=lambda path, value, *_: writes.append((path.name, value))):
            result = adapter.cleanup()
        self.assertFalse(result['providerRevoked'])
        self.assertTrue(any(command[:2] == ['docker', 'stop'] for command in commands))
        self.assertEqual(writes[-1][0], 'cleanup.private.json')


if __name__ == '__main__':
    unittest.main()
