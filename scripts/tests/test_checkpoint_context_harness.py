"""Pure fake-command guard tests. No PostgreSQL, subprocess or socket is started."""
from pathlib import Path
import importlib.util
import contextlib
import io
import json
import os
import tempfile
import unittest
from unittest.mock import patch

MODULE = Path(__file__).resolve().parents[1] / 'test-checkpoint-context-isolated.py'
spec = importlib.util.spec_from_file_location('checkpoint_context_harness', MODULE)
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)


class FakeCommands:
    def __init__(self):
        self.events = []
        self.data = None
        self.live = False
        self.fail_test = False
        self.wrong_identity = False
        self.wrong_target = False

    def preflight(self, root):
        return None

    def guard(self, script, **kwargs):
        self.events.append(('guard', str(script)))
        return 4321

    def run(self, args, **kwargs):
        args = [str(v) for v in args]
        self.events.append((Path(args[0]).name, args, kwargs))
        if 'initdb' in args[0]:
            self.data = Path(args[args.index('-D')+1])
            self.data.mkdir(mode=0o700)
        elif Path(args[0]).name == 'pg_ctl':
            if args[-1] == 'start':
                self.live = True
                (self.data / 'postmaster.pid').write_text('9999\n'+str(self.data)+'\n0\n'+h.PORT+'\n')
                (self.data.parent / 'socket' / ('.s.PGSQL.'+h.PORT)).write_text('fake socket marker')
            else:
                self.live = False
                (self.data / 'postmaster.pid').unlink(missing_ok=True)
                (self.data.parent / 'socket' / ('.s.PGSQL.'+h.PORT)).unlink(missing_ok=True)
        elif Path(args[0]).name == 'psql':
            return ('/different/retained/data' if self.wrong_target else str(self.data))+'\t\n'
        elif Path(args[0]).name == 'pnpm':
            if self.fail_test:
                raise RuntimeError('fake suite failure')
            return 'Fake suite passed; not real PostgreSQL evidence\n'
        return ''

    def terminate_owned(self, names, data, uid):
        self.events.append(('terminate_owned', names, str(data), uid))

    def alive(self, pid):
        return self.live if pid == 9999 else False

    def owns_postgres(self, pid, data, uid):
        return not self.wrong_identity and pid == 9999 and data == self.data and uid == os.getuid()


class GuardTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='01-context-harness-unit-')
        self.base = Path(self.temp.name)
        self.root = self.base / 'repo'
        self.root.mkdir()
        self.fake = FakeCommands()
        self.subject = h.Rehearsal(self.root, self.fake, self.base, now=lambda: 1000)
        self.no_run = patch('subprocess.run', side_effect=AssertionError('Real subprocess forbidden'))
        self.no_popen = patch('subprocess.Popen', side_effect=AssertionError('Real process forbidden'))
        self.no_run.start()
        self.no_popen.start()

    def tearDown(self):
        self.no_popen.stop()
        self.no_run.stop()
        self.temp.cleanup()  # Only unit-test temporary files; never rehearsal data.

    def record(self):
        path = Path(tempfile.mkdtemp(prefix=h.PREFIX, dir=self.base))
        path.chmod(0o700)
        (path/'socket').mkdir(mode=0o700)
        return {'version': 1, 'directory': str(path), 'uid': os.getuid(), 'database': h.DATABASE,
                'port': h.PORT, 'created': 1000, 'deadline': 2800, 'parent_pid': 1234,
                'stopped': False}

    def test_construction_and_plan_are_side_effect_free(self):
        self.assertFalse(self.subject.output.exists())
        self.assertFalse(h.PLAN['tcp'])
        self.assertEqual(h.PLAN['migrations'], ['registered0000-0010', 'draft0011', 'draft0014'])
        self.assertFalse(h.PLAN['application_credentials_or_auth_accounts'])
        self.assertFalse(self.fake.events)

    def test_minimal_environment_never_inherits_connection_or_auth_values(self):
        with patch.dict(os.environ, {'PGPASSWORD': 'unit-only', 'DATABASE_URL': 'unit-only',
                                    'SUPABASE_SERVICE_ROLE_KEY': 'unit-only'}):
            env = h.environment(self.root)
        self.assertNotIn('PGPASSWORD', env)
        self.assertNotIn('DATABASE_URL', env)
        self.assertNotIn('SUPABASE_SERVICE_ROLE_KEY', env)
        self.assertEqual(env['PGPASSFILE'], '/dev/null')
        self.assertEqual(env['PGSERVICEFILE'], '/dev/null')

    def test_rejects_unrelated_database_path_role_identity_and_expiry_extension(self):
        r = self.record()
        for change in [{'directory': str(self.root)}, {'directory': '/'}, {'uid': os.getuid()+1},
                       {'database': 'postgres'}, {'port': '5432'}, {'version': 2},
                       {'deadline': 2801}, {'deadline': 1000}, {'deadline': float('nan')},
                       {'deadline': float('inf')}, {'created': True}]:
            with self.subTest(change=change):
                with self.assertRaises(RuntimeError):
                    h.validate_record({**r, **change}, self.base, os.getuid())

    def test_rejects_world_accessible_or_symlink_cluster_directory(self):
        r = self.record()
        path = Path(r['directory'])
        path.chmod(0o755)
        with self.assertRaises(RuntimeError):
            h.validate_record(r, self.base, os.getuid())
        path.chmod(0o700)
        link = self.base / (h.PREFIX+'link')
        link.symlink_to(path)
        with self.assertRaises(RuntimeError):
            h.validate_record({**r, 'directory': str(link)}, self.base, os.getuid())

    def test_refuses_existing_or_uncertain_control_before_creating_any_cluster(self):
        self.subject.save(self.record())
        before = set(self.base.iterdir())
        with self.assertRaisesRegex(RuntimeError, 'Existing control'):
            self.subject.run(MODULE)
        self.assertEqual(before, set(self.base.iterdir()))
        self.assertFalse(self.fake.events)

    def test_refuses_unsafe_control_permissions(self):
        self.subject.save(self.record())
        self.subject.control.chmod(0o644)
        with self.assertRaises(RuntimeError):
            self.subject.load()

    def test_refuses_evidence_symlink_escape_before_any_write(self):
        outside = self.base / 'outside'
        outside.mkdir()
        self.subject.output.parent.mkdir()
        self.subject.output.symlink_to(outside)
        with self.assertRaisesRegex(RuntimeError, 'existing workspace'):
            self.subject.save(self.record())
        self.assertEqual(list(outside.iterdir()), [])

    def test_exact_fake_run_arms_guard_first_stops_and_retains_data(self):
        result = self.subject.run(MODULE)
        self.assertTrue(result['tests_passed'])
        self.assertFalse(result['real_postgres'])
        self.assertTrue(result['cleanup']['postgres_stopped'])
        self.assertFalse(result['cleanup']['permanent_deletion'])
        self.assertTrue(self.fake.data.exists())
        self.assertFalse(self.fake.live)
        self.assertEqual(self.fake.events[0][0], 'guard')
        commands = [e[1] for e in self.fake.events if e[0] not in ['guard','terminate_owned']]
        self.assertFalse(any('dropdb' in str(v) for v in commands))
        pg = next(v for v in commands if Path(v[0]).name == 'pg_ctl' and v[-1] == 'start')
        self.assertIn("listen_addresses=''", pg[pg.index('-o')+1])
        suite = next(e for e in self.fake.events if e[0] == 'pnpm')
        self.assertIn('packages/db/vitest.context.config.ts', suite[1])
        self.assertEqual(suite[2]['env']['DRAFT_TEST_DB'], h.DATABASE)
        self.assertEqual(suite[2]['env']['DRAFT_CONTEXT_REHEARSAL'], '0011+0014')
        self.assertEqual(self.subject.load()['deadline']-self.subject.load()['created'], h.MAX_SECONDS)

    def test_fake_suite_failure_still_stops_and_retains_its_private_data(self):
        self.fake.fail_test = True
        with self.assertRaisesRegex(RuntimeError, 'fake suite'):
            self.subject.run(MODULE)
        self.assertFalse(self.fake.live)
        self.assertTrue(self.subject.load()['stopped'])
        self.assertTrue(self.fake.data.exists())

    def test_target_mismatch_prevents_testing_and_stops_only_owned_cluster(self):
        self.fake.wrong_target = True
        with self.assertRaisesRegex(RuntimeError, 'recorded private cluster'):
            self.subject.run(MODULE)
        self.assertFalse(any(e[0] == 'pnpm' for e in self.fake.events))
        self.assertFalse(self.fake.live)
        self.assertTrue(self.fake.data.exists())

    def test_pid_identity_mismatch_is_reported_without_signalling_another_process(self):
        self.subject.run(MODULE)
        r = self.subject.load()
        r['stopped'] = False
        self.subject.save(r)
        self.fake.run([h.PG/'pg_ctl','-D',self.fake.data,'start'])
        self.fake.wrong_identity = True
        before = len(self.fake.events)
        with self.assertRaisesRegex(RuntimeError, 'process identity changed'):
            self.subject.stop()
        self.assertFalse(any(e[0] == 'pg_ctl' and e[1][-1] == 'stop' for e in self.fake.events[before:]))
        self.assertFalse(self.subject.load()['stopped'])

    def test_expired_clock_forbids_new_commands(self):
        r = self.record()
        self.subject.now = lambda: 2800
        with self.assertRaisesRegex(RuntimeError, 'expired'):
            self.subject.command(['should-not-run'], r)
        self.assertFalse(self.fake.events)

    def test_expiry_watchdog_stops_the_recorded_fake_cluster(self):
        self.subject.run(MODULE)
        r = self.subject.load()
        r['stopped'] = False
        self.subject.save(r)
        self.fake.run([h.PG/'pg_ctl','-D',self.fake.data,'start'])
        self.subject.now = lambda: 2800
        with contextlib.redirect_stdout(io.StringIO()) as result:
            self.subject.watchdog()
        self.assertTrue(json.loads(result.getvalue())['postgres_stopped'])
        self.assertFalse(self.fake.live)
        self.assertTrue(self.subject.load()['stopped'])


if __name__ == '__main__':
    unittest.main()
