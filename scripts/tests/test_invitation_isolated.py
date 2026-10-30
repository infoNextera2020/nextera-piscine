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

spec = importlib.util.spec_from_file_location('invitation_isolated_controller', Path(__file__).resolve().parents[1] / 'test-invitation-isolated.py')
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)


def fake_source_repo(root):
    """Every hashed source byte is a fixture; missing in-flight runner files do not matter."""
    root.mkdir(mode=0o700)
    for name in h.SOURCE_FILES:
        path = root / name
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        path.write_text('// synthetic source fixture only\n')
    journal = {'entries': [{'idx': i, 'tag': f'{i:04d}_fixture'} for i in range(11)]}
    (root / h.JOURNAL).write_text(json.dumps(journal))
    for entry in journal['entries']:
        (root / 'packages/db/migrations' / (entry['tag'] + '.sql')).write_text('-- synthetic SQL fixture; never executed\n')
    driver = root / 'node_modules/postgres'
    (driver / 'src').mkdir(mode=0o700, parents=True)
    (driver / 'package.json').write_text(json.dumps({'version': '3.4.9'}))
    (driver / 'src/index.js').write_text('// fake driver source; never imported\n')
    return root


class FakeCommands:
    def __init__(self):
        self.events = []
        self.running = False
        self.fail = None
        self.parent_lost = False
        self.boot_changed = False
        self.controller = None
        self.guard_script = None

    def preflight(self, root):
        self.events.append('preflight')
        if self.fail == 'preflight':
            raise RuntimeError('fake preflight')

    def boot_id(self):
        return 'changed-boot' if self.boot_changed else 'fake-boot'

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
        if pid == os.getpid() and self.parent_lost:
            return False
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
            assert Path(args[1]) == c.target / 'snapshot/scripts/test-invitation-rehearsal.mjs'
            assert args[2] == '--execute-approved-private-rehearsal'
            assert Path(args[3]) == c.target / 'control.json'
            result = {'state': 'passed', 'scope_sha256': c.load()['scope_sha256'],
                      'cleanup': dict(h.REQUIRED_SQL_CLEANUP)}
            if self.fail == 'sql_cleanup':
                result['cleanup']['policy_disabled'] = False
            if self.fail == 'bad_scope':
                result['scope_sha256'] = 'b' * 64
            if self.fail == 'assertions_failed':
                result['state'] = 'failed'
            if self.fail == 'extra_cleanup':
                result['cleanup']['unexpected'] = True
            h.write_private(c.target / 'evidence/assertions.json', result)
            if self.fail == 'malformed_assertions':
                (c.target / 'evidence/assertions.json').write_text('not JSON')
            if self.fail == 'unsafe_assertions':
                (c.target / 'evidence/assertions.json').chmod(0o644)
        return ''


class ControllerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='fake-invitation-controller-', dir='/tmp')
        self.addCleanup(self.temp.cleanup)
        self.target = Path(self.temp.name) / 'new-fixture' / 'run-001'
        self.repo = fake_source_repo(Path(self.temp.name) / 'sources')
        self.clock = {'wall': 1000.0, 'mono': 5000.0}
        self.commands = FakeCommands()
        self.c = h.Controller(self.repo, commands=self.commands, target=self.target,
                              now=lambda: self.clock['wall'], monotonic=lambda: self.clock['mono'])
        self.commands.controller = self.c
        self.approval = {'owner_message_id': 'Sentinel_injected_fake_not_human_approval',
                         'owner_approved_at': dt.datetime.fromtimestamp(999, dt.timezone.utc).isoformat(),
                         'scope_sha256': h.plan(self.repo)['scope_sha256']}

    def test_plan_import_and_constructor_do_not_create_target(self):
        self.assertFalse(self.target.exists())
        self.assertEqual(self.commands.events, [])
        self.assertEqual(len(h.SCOPE['nologin_roles']), 14)
        self.assertFalse(h.SCOPE['tcp'])

    def test_fake_success_guard_precedes_init_and_cleanup_retains(self):
        result = self.c.run(self.approval)
        self.assertTrue(result['passed'])
        self.assertFalse(self.commands.running)
        self.assertLess(self.commands.events.index('guard'), self.commands.events.index('initdb'))
        self.assertTrue((self.target / 'data').exists())
        self.assertTrue(result['cleanup']['sql_cleanup_acknowledged'])
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
        for failure in ['guard','bad_guard','initdb','after_start','target','createdb','node','sql_cleanup',
                        'bad_scope','malformed_assertions','unsafe_assertions','extra_cleanup']:
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
        if not self.target.parent.resolve().is_relative_to(Path(self.temp.name).resolve()):
            raise RuntimeError('Refuse cleanup outside disposable OS-temp fixture')
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

    def test_real_entrypoint_requires_fresh_approval_before_any_runtime_path_or_command(self):
        real = h.Controller(self.repo, now=lambda: 2000.0)
        with patch.object(Path, 'mkdir') as mkdir, patch.object(real, 'preflight') as preflight:
            with self.assertRaisesRegex(RuntimeError, 'Approval is future or expired'):
                real.run(self.approval)
            mkdir.assert_not_called()
            preflight.assert_not_called()

    def test_invalid_control_fails_closed(self):
        self.c.run(self.approval)
        control = self.target / 'control.json'
        r = json.loads(control.read_text())
        r['monotonic_deadline'] += 1
        h.write_private(control, r)
        with self.assertRaises(RuntimeError):
            self.c.load()


    def test_sql_cleanup_requires_exact_json_booleans(self):
        self.assertTrue(h.valid_sql_cleanup(dict(h.REQUIRED_SQL_CLEANUP)))
        self.assertFalse(h.valid_sql_cleanup({key: 1 for key in h.REQUIRED_SQL_CLEANUP}))
        self.assertFalse(h.valid_sql_cleanup({key: 'true' for key in h.REQUIRED_SQL_CLEANUP}))
        self.assertFalse(h.valid_sql_cleanup({'roles_disabled': True}))
        self.assertFalse(h.valid_sql_cleanup({**h.REQUIRED_SQL_CLEANUP, 'extra': True}))

    def test_scope_contains_only_invitation_drafts_and_exact_restricted_roles(self):
        value = h.plan(self.repo)
        self.assertTrue(value['prepared_source_ready'])
        self.assertFalse(value['runtime_ready'])
        self.assertFalse(value['real_postgres_verified'])
        self.assertTrue(value['fresh_runtime_approval_required'])
        self.assertEqual(len(set(h.SCOPE['nologin_roles'])), 14)
        self.assertEqual(h.SCOPE['issuer'], h.ISSUER)
        self.assertEqual(h.SCOPE['activator'], h.ACTIVATOR)
        self.assertEqual(h.SCOPE['required_sql_cleanup'], h.REQUIRED_SQL_CLEANUP)
        drafts = [Path(name).name for name in value['sources'] if '/migration-drafts/' in name]
        self.assertEqual(drafts, ['0013_invitations.DRAFT.sql', '0020_invitation_issuance.DRAFT.sql',
                                  '0016_invitation_operations.DRAFT.sql', '0018_invitation_admission.DRAFT.sql'])
        self.assertIn('scripts/tests/invitation-rehearsal.node-unit.mjs', value['sources'])
        self.assertIn('scripts/tests/test_invitation_isolated.py', value['sources'])
        self.assertEqual(h.MAX_SECONDS, 1800)
        self.assertEqual(h.CLEANUP_EARLY, 180)
        self.assertEqual(h.APPROVAL_SECONDS, 600)
        self.assertEqual(h.PORT, '55461')
        self.assertFalse(self.target.parent.exists())

    def test_source_changes_bind_a_new_scope_without_creating_resources(self):
        before = h.plan(self.repo)
        file = self.repo / 'scripts/test-invitation-rehearsal.mjs'
        file.write_text('// changed synthetic source fixture\n')
        after = h.plan(self.repo)
        self.assertNotEqual(before['scope_sha256'], after['scope_sha256'])
        with self.assertRaises(RuntimeError):
            self.c.run(self.approval)
        self.assertFalse(self.target.parent.exists())
        self.assertEqual(self.commands.events, [])

    def test_source_manifest_rejects_wrong_journal_driver_and_symlink(self):
        journal = self.repo / h.JOURNAL
        original = journal.read_text()
        value = json.loads(original)
        value['entries'][-1]['idx'] = 11
        journal.write_text(json.dumps(value))
        with self.assertRaises(RuntimeError):
            h.plan(self.repo)
        value = json.loads(original)
        value['entries'][0]['tag'] = '../escape'
        journal.write_text(json.dumps(value))
        with self.assertRaises(RuntimeError):
            h.plan(self.repo)
        journal.write_text(original)
        package = self.repo / 'node_modules/postgres/package.json'
        package.write_text('{"version":"9.9.9"}')
        with self.assertRaises(RuntimeError):
            h.plan(self.repo)
        package.write_text('{"version":"3.4.9"}')
        file = self.repo / 'scripts/test-invitation-rehearsal.mjs'
        file.unlink()
        file.symlink_to(self.repo / 'scripts/test-invitation-isolated.py')
        with self.assertRaises(RuntimeError):
            h.plan(self.repo)
        self.assertFalse(self.target.exists())

    def test_sql_cleanup_acknowledgement_is_independent_of_assertion_success(self):
        self.commands.fail = 'assertions_failed'
        result = self.c.run(self.approval)
        self.assertFalse(result['passed'])
        self.assertTrue(result['cleanup']['postgres_stopped'])
        self.assertTrue(result['cleanup']['sql_cleanup_acknowledged'])

    def test_missing_or_unbound_sql_cleanup_evidence_never_counts_as_acknowledged(self):
        self.c.run(self.approval)
        assertions = self.target / 'evidence/assertions.json'
        assertions.unlink()
        self.assertFalse(self.c.stop()['sql_cleanup_acknowledged'])
        h.write_private(assertions, {'scope_sha256': 'b' * 64,
                                    'cleanup': dict(h.REQUIRED_SQL_CLEANUP)})
        self.assertFalse(self.c.stop()['sql_cleanup_acknowledged'])
        assertions.write_text('not JSON')
        self.assertFalse(self.c.stop()['sql_cleanup_acknowledged'])

    def test_stale_postmaster_identity_never_authorizes_shutdown(self):
        self.commands.fail = 'identity'
        with self.assertRaisesRegex(RuntimeError, 'Postmaster process changed'):
            self.c.run(self.approval)
        self.assertNotIn('pg_ctl:stop', self.commands.events)
        self.assertNotIn('terminate:postgres', self.commands.events)
        self.assertFalse((self.target / 'evidence/cleanup.json').exists())

    def test_pending_process_shutdown_is_not_reported_as_success(self):
        self.commands.fail = 'stuck'
        with self.assertRaisesRegex(RuntimeError, 'cleanup remains pending'):
            self.c.run(self.approval)
        self.assertFalse((self.target / 'evidence/cleanup.json').exists())

    def test_closed_target_rejects_further_commands(self):
        self.c.run(self.approval)
        before = list(self.commands.events)
        with self.assertRaisesRegex(RuntimeError, 'Closed target'):
            self.c.command(['FAKE'], self.c.load())
        self.assertEqual(self.commands.events, before)

    def test_watchdog_stops_on_parent_loss_boot_change_or_dual_deadline(self):
        for mode in ['parent', 'boot', 'wall', 'monotonic']:
            with self.subTest(mode=mode):
                self.c.run(self.approval)
                record = self.c.load()
                (self.target / 'evidence/cleanup.json').unlink()
                self.commands.parent_lost = mode == 'parent'
                self.commands.boot_changed = mode == 'boot'
                if mode == 'wall':
                    self.clock['wall'] = record['cleanup_at']
                if mode == 'monotonic':
                    self.clock['wall'] -= 500
                    self.clock['mono'] = record['monotonic_cleanup_at']
                self.c.watchdog()
                self.assertTrue((self.target / 'evidence/cleanup.json').exists())
                self.assertFalse(self.commands.running)
                self.tearDownFixture()
                self.clock.update(wall=1000.0, mono=5000.0)
                self.commands.parent_lost = False
                self.commands.boot_changed = False

    def test_control_role_identity_is_bound_before_cleanup(self):
        self.c.run(self.approval)
        control = self.target / 'control.json'
        r = json.loads(control.read_text())
        r['issuer'] = h.ACTOR
        h.write_private(control, r)
        with self.assertRaisesRegex(RuntimeError, 'Control scope'):
            self.c.load()


if __name__ == '__main__':
    unittest.main()
