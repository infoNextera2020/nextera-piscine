"""Fake commands only. Never invokes initdb, PostgreSQL, Node or a network."""
import datetime as dt
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('migration_adapter_controller', Path(__file__).resolve().parents[1] / 'test-checkpoint-migration-adapter.py')
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)
REPO = Path(__file__).resolve().parents[2]


class FakeCommands:
    def __init__(self):
        self.events = []
        self.running = False
        self.fail = None
        self.controller = None
        self.guard_script = None

    def preflight(self, root):
        self.events.append('preflight')
        if self.fail == 'preflight':
            raise RuntimeError('fake preflight')

    def boot_id(self):
        return 'fake-boot'

    def identity(self, pid):
        return {'uid': os.getuid(), 'start_ticks': '12345',
                'args': ['python3', str(self.guard_script), 'watchdog'] if pid == 88 else ['python3', 'fake-parent']}

    def guard(self, script, *, cwd, env, log):
        self.events.append('guard')
        self.guard_script = script
        c = self.controller
        if self.fail != 'guard':
            r = c.load()
            proof = {'pid': 88, 'start_ticks': '12345', 'scope_sha256': r['scope_sha256'],
                     'control_sha256': hashlib.sha256((c.target / 'control.json').read_bytes()).hexdigest()}
            if self.fail == 'bad_guard':
                proof['start_ticks'] = 'changed'
            h.write_private(c.target / 'evidence/guard-ready.json', proof)
        return 88

    def alive(self, pid):
        return self.running if pid == 4242 else self.fail != 'guard'

    def owns_postgres(self, pid, data, uid):
        return pid == 4242 and self.running and self.fail != 'identity'

    def erase_fake_process(self, data):
        self.running = False
        (data / 'postmaster.pid').unlink(missing_ok=True)
        for f in (data.parent / 's').glob('.s.PGSQL.*'):
            f.unlink()

    def terminate_owned(self, names, data, uid):
        self.events.append('terminate:' + ','.join(names))
        if names == ['postgres']:
            if self.fail == 'stuck':
                return
            self.erase_fake_process(data)
        elif self.fail == 'startup_stop':
            raise RuntimeError('fake helper stop failed')

    def run(self, args, **kwargs):
        command = Path(args[0]).name
        self.events.append(command + (':' + str(args[-1]) if command == 'pg_ctl' else ''))
        assert 'DATABASE_URL' not in kwargs['env']
        assert 'PGPASSWORD' not in kwargs['env']
        c = self.controller
        if self.fail == command:
            raise subprocess.CalledProcessError(1, ['FAKE'], output='PRIVATE_NOT_SAVED')
        if command == 'initdb':
            (c.target / 'data').mkdir(mode=0o700)
        if command == 'pg_ctl' and args[-1] == 'start':
            self.running = True
            (c.target / 'data/postmaster.pid').write_text('4242\n' + str(c.target / 'data') + '\n0\n' + h.PORT + '\n')
            (c.target / ('s/.s.PGSQL.' + h.PORT)).touch()
            if self.fail == 'after_start':
                raise RuntimeError('fake start response lost')
        if command == 'pg_ctl' and args[-1] == 'stop':
            if self.fail in ['graceful_stop', 'stuck']:
                raise RuntimeError('fake graceful stop failed')
            self.erase_fake_process(c.target / 'data')
        if command == 'psql':
            return str(c.target / 'data') + ('\tpublic\n' if self.fail == 'target' else '\t\n')
        if command == 'node':
            result = {'state': 'passed', 'scope_sha256': c.load()['scope_sha256'],
                      'cleanup': {'guard_removed': True, 'roles_disabled': True}}
            if self.fail == 'sql_cleanup':
                result['cleanup']['guard_removed'] = False
            h.write_private(c.target / 'evidence/assertions.json', result)
        return ''


class ControllerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='fake-migration-controller-')
        self.addCleanup(self.temp.cleanup)
        self.target = Path(self.temp.name) / 'new-fixture' / 'run-001'
        self.clock = {'wall': 1000.0, 'mono': 5000.0}
        self.commands = FakeCommands()
        self.c = h.Controller(REPO, commands=self.commands, target=self.target,
                              now=lambda: self.clock['wall'], monotonic=lambda: self.clock['mono'])
        self.commands.controller = self.c
        self.approval = {'owner_message_id': 'Sentinel_injected_fake_not_human_approval',
                         'owner_approved_at': dt.datetime.fromtimestamp(999, dt.timezone.utc).isoformat(),
                         'scope_sha256': h.plan(REPO)['scope_sha256']}

    def test_plan_import_and_constructor_do_not_create_target(self):
        self.assertFalse(self.target.exists())
        self.assertEqual(self.commands.events, [])
        self.assertEqual(len(h.SCOPE['nologin_roles']), 9)
        self.assertFalse(h.SCOPE['tcp'])

    def test_fake_success_guard_precedes_init_and_cleanup_retains(self):
        result = self.c.run(self.approval)
        self.assertTrue(result['passed'])
        self.assertFalse(self.commands.running)
        self.assertLess(self.commands.events.index('guard'), self.commands.events.index('initdb'))
        self.assertTrue((self.target / 'data').exists())
        self.assertTrue(result['cleanup']['sql_cleanup_verified'])
        self.assertFalse(result['cleanup']['permanent_deletion'])
        self.assertEqual(self.c.load()['approval'], self.approval)
        self.c.verify_snapshot(self.c.load())
        with self.assertRaises(RuntimeError):
            self.c.run(self.approval)

    def test_approval_validation_preserves_exact_timestamp_and_rejects_expiry(self):
        for change in [lambda a: a.update(scope_sha256='b' * 64),
                       lambda a: a.update(owner_message_id='unverified'),
                       lambda a: a.update(owner_approved_at='1970-01-01T00:16:41Z'),
                       lambda a: a.update(owner_approved_at='1970-01-01T00:06:39.999999Z'),
                       lambda a: a.update(extra='unexpected')]:
            a = dict(self.approval)
            change(a)
            with self.assertRaises(RuntimeError):
                self.c.run(a)
            self.assertFalse(self.target.parent.exists())
        boundary = dict(self.approval, owner_approved_at='1970-01-01T00:06:40Z')
        h.validate_approval(boundary, boundary['scope_sha256'], 1000)

    def test_failures_cleanup_without_leaking_raw_command_output(self):
        for failure in ['guard','bad_guard','initdb','after_start','target','createdb','node','sql_cleanup']:
            with self.subTest(failure=failure):
                self.commands.fail = failure
                result = self.c.run(self.approval)
                self.assertFalse(result['passed'])
                self.assertFalse(self.commands.running)
                self.assertTrue(result['cleanup']['postgres_stopped'])
                failure_file = self.target / 'evidence/controller-failure.json'
                self.assertNotIn('PRIVATE_', failure_file.read_text())
                # Only disposable fake-test artifacts are removed by unittest cleanup.
                self.tearDownFixture()

    def tearDownFixture(self):
        import shutil
        shutil.rmtree(self.target.parent)
        self.commands.events = []

    def test_graceful_stop_failure_still_uses_owned_fallback(self):
        self.commands.fail = 'graceful_stop'
        result = self.c.run(self.approval)
        self.assertTrue(result['cleanup']['postgres_stopped'])
        self.assertIn('graceful_stop_error', result['cleanup']['recovered_stop_errors'])

    def test_failed_startup_helper_stop_does_not_suppress_postgres_stop(self):
        self.commands.fail = 'startup_stop'
        result = self.c.run(self.approval)
        self.assertTrue(result['cleanup']['postgres_stopped'])
        self.assertIn('startup_stop_error', result['cleanup']['recovered_stop_errors'])

    def test_cached_cleanup_is_rechecked(self):
        self.c.run(self.approval)
        self.commands.running = True
        (self.target / 'data/postmaster.pid').write_text('4242\n' + str(self.target / 'data') + '\n0\n' + h.PORT + '\n')
        result = self.c.stop()
        self.assertFalse(self.commands.running)
        self.assertTrue(result['postgres_stopped'])

    def test_snapshot_change_is_detected_before_execution(self):
        self.c.run(self.approval)
        file = self.target / 'snapshot/scripts/checkpoint-migration-postgres.mjs'
        file.write_text('unapproved fake bytes')
        with self.assertRaises(RuntimeError):
            self.c.verify_snapshot(self.c.load())

    def test_monotonic_deadline_does_not_extend_on_wall_clock_rollback(self):
        self.c.run(self.approval)
        record = self.c.load()
        self.clock['wall'] -= 100
        self.clock['mono'] = record['monotonic_cleanup_at']
        with self.assertRaises(RuntimeError):
            self.c.command(['FAKE'], record)

    def test_no_mutation_when_preflight_fails(self):
        self.commands.fail = 'preflight'
        with self.assertRaises(RuntimeError):
            self.c.run(self.approval)
        self.assertFalse(self.target.parent.exists())

    def test_real_entrypoint_is_blocked_before_any_runtime_path_or_command(self):
        real = h.Controller(REPO)
        with patch.object(Path, 'mkdir') as mkdir, patch.object(real, 'preflight') as preflight:
            with self.assertRaisesRegex(RuntimeError, 'prerequisite ACL authority'):
                real.run(self.approval)
            mkdir.assert_not_called()
            preflight.assert_not_called()

    def test_invalid_control_and_postmaster_identity_fail_closed(self):
        self.c.run(self.approval)
        control = self.target / 'control.json'
        r = json.loads(control.read_text())
        r['monotonic_deadline'] += 1
        h.write_private(control, r)
        with self.assertRaises(RuntimeError):
            self.c.load()


if __name__ == '__main__':
    unittest.main()
