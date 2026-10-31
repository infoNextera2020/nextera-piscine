"""Injected native Job and private-pipe tests. No browser/Auth/guard/runtime starts."""
from pathlib import Path
import copy
import hashlib
import importlib.util
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
SOURCE = Path(__file__).resolve().parents[1] / 'week1-auth-browser-host.py'
setup = importlib.util.spec_from_file_location('browser_host_under_test', SOURCE)
h = importlib.util.module_from_spec(setup); setup.loader.exec_module(h)


def config():
    return {'binding': {'driver': 'native-windows-parent-v1', 'session': 'a'*64,
        'scopeSha256': 'b'*64, 'sourceLockSha256': 'c'*64, 'reviewedHead': 'd'*40,
        'profile': h.PROFILE, 'root': h.ROOT, 'project': '01coding-' + h.PROFILE},
        'repo': h.REPO, 'cache': r'C:\fixture-owned-cache', 'manifestSha256': 'e'*64,
        'started': 1000000, 'deadline': 4600000, 'cleanupAt': 4420000,
        'helperSha256': '1'*64, 'brokerSha256': '2'*64, 'consumerSha256': '3'*64, 'hostSha256': '4'*64}


class FakePort:
    def __init__(self, c):
        self.c = c; self.wall = 1100000; self.monotonic = 100
        self.calls = []; self.reads = 0; self.issued = False
        self.profile = r'C:\fixture-owned-cache\browser-unique\chrome-profile'
        self.waiting = {'registrationDriver': 'operator-browser-learner-b',
            'scopeSha256': 'b'*64, 'sourceLockSha256': 'c'*64, 'startedAt': self.wall}
        self.ack = {'version': 1, 'scopeSha256': 'b'*64, 'sourceLockSha256': 'c'*64,
            'nonce': '10000000-0000-4000-8000-000000000001',
            'issueRequestId': '10000000-0000-4000-8000-000000000002',
            'origin': 'http://127.0.0.1:3151', 'cohortId': '10000000-0000-4000-8000-000000000003',
            'email': 'week1-b-20261030-invitation1@example.invalid', 'displayName': 'Week 1 Synthetic Learner B',
            'expiresAt': self.wall + 100000, 'tokenSha256': '5'*64, 'issuedAt': self.wall}
        self.alter = lambda value: value

    def now(self): return self.wall
    def mono(self): return self.monotonic
    def sleep(self, seconds): self.wall += round(seconds * 1000); self.monotonic += round(seconds * 1000)

    def metadata(self, seconds):
        self.calls.append(('metadata', seconds)); self.reads += 1
        c = self.c
        control = {k: c[k] for k in ['started', 'deadline', 'cleanupAt']}
        control.update({k: c['binding'][k] for k in ['profile', 'project', 'scopeSha256', 'sourceLockSha256']})
        control.update(hostDriver=c['binding'], state='reserved')
        active = {**control, 'state': 'active', 'phase': 'invitations_active'}
        return self.alter({'control': control, 'active': active,
            'waiting': None if self.reads == 1 else copy.deepcopy(self.waiting),
            'ack': copy.deepcopy(self.ack) if self.issued else None,
            'lockSha256': 'c'*64, 'sources': {'scripts/week1-auth-rehearsal.py': '1'*64,
                'scripts/week1-auth-live-broker.mjs': '2'*64, 'scripts/week1-auth-browser-consumer.mjs': '3'*64,
                'scripts/week1-auth-browser-host.py': '4'*64}, 'cleanupStarted': False})

    def handoff(self, seconds):
        self.calls.append(('handoff', seconds)); self.issued = True
        return {**self.ack, 'url': 'http://127.0.0.1:3151/signup#invitation=SYNTHETIC_ONLY', 'password': '6'*48}

    def preflight(self, seconds): self.calls.append(('preflight', seconds))

    def consume(self, envelope, seconds):
        self.calls.append(('consume', seconds)); self.envelope = envelope
        self.proof = {k: self.ack[k] for k in ['version', 'scopeSha256', 'sourceLockSha256', 'nonce',
            'issueRequestId', 'tokenSha256', 'origin', 'email', 'cohortId']}
        self.proof.update(observedAt=self.wall, browser='chrome', checks={k: True for k in
            ['fragmentRemoved', 'inviteEmailFixed', 'activationSucceeded', 'ordinaryLoginSucceeded']})
        return self.proof

    def record(self, proof, seconds):
        self.calls.append(('record', seconds))
        return {'status': 'recorded', 'replayed': False, 'scopeSha256': proof['scopeSha256'],
            'nonce': proof['nonce'], 'proofSha256': h.sha(json.dumps(proof, sort_keys=True,
                ensure_ascii=False, separators=(',', ':')).encode() + b'\n')}


class WorkerTests(unittest.TestCase):
    def setUp(self): self.c = config(); self.port = FakePort(self.c)

    def test_real_chain_waits_marker_then_one_private_handoff_independent_ack_consume_record(self):
        result = h.run_worker(self.c, self.port)
        self.assertEqual([x[0] for x in self.port.calls], ['metadata', 'metadata', 'preflight', 'handoff', 'metadata', 'preflight', 'consume', 'record'])
        self.assertEqual(set(result), h.SAFE_KEYS)
        self.assertNotIn('password', json.dumps(result)); self.assertNotIn('invitation=', json.dumps(result))
        self.assertFalse(result['privateInputPersisted']); self.assertTrue(result['contextClosed'])
        self.assertEqual(set(self.port.envelope), {'handoff', 'expectedScope', 'awaitingStartedAt', 'cleanupAt',
            'deadline', 'coreUrl', 'executablePath', 'profileDir', 'coreTreeSha256'})
        self.assertEqual(self.port.envelope['coreTreeSha256'], h.CORE_TREE_SHA256)
        self.assertEqual(self.port.envelope['deadline'], min(self.port.waiting['startedAt'] + 150000,
            self.c['cleanupAt'], self.port.ack['expiresAt']))

    def test_wrong_scope_source_lock_lease_cleanup_or_inactive_marker_prevents_issuance(self):
        mutations = [lambda x: x.update(cleanupStarted=True), lambda x: x.update(lockSha256='0'*64),
            lambda x: x['control'].update(cleanupAt=self.c['cleanupAt'] + 1),
            lambda x: x['control'].update(hostDriver={}), lambda x: x['sources'].update({'scripts/week1-auth-live-broker.mjs': '0'*64}),
            lambda x: x['active'].update(phase='other')]
        for change in mutations:
            port = FakePort(self.c)
            def alter(value, change=change): change(value); return value
            port.alter = alter
            with self.subTest(change=change), self.assertRaises(h.BrowserHostError): h.run_worker(self.c, port)
            self.assertNotIn('handoff', [x[0] for x in port.calls])

    def test_existing_ack_never_adopted_or_reissued(self):
        self.port.issued = True
        with self.assertRaises(h.BrowserHostError): h.run_worker(self.c, self.port)
        self.assertNotIn('handoff', [x[0] for x in self.port.calls])

    def test_ack_is_independent_and_changed_marker_or_ack_blocks_consumer(self):
        for kind in ['marker', 'ack']:
            port = FakePort(self.c)
            def alter(value):
                if port.issued:
                    if kind == 'marker': value['waiting']['startedAt'] += 1
                    else: value['ack']['tokenSha256'] = '0'*64
                return value
            port.alter = alter
            with self.subTest(kind=kind), self.assertRaises(h.BrowserHostError): h.run_worker(self.c, port)
            self.assertNotIn('consume', [x[0] for x in port.calls])

    def test_original_window_not_fresh_150_seconds_and_wall_reversal_or_monotonic_expiry_stop(self):
        for clock in ['wall', 'mono', 'window']:
            port = FakePort(self.c)
            original = port.handoff
            def handoff(seconds):
                value = original(seconds)
                if clock == 'wall': port.wall = 1
                if clock == 'mono': port.monotonic += 150001
                if clock == 'window': port.wall += 150001
                return value
            port.handoff = handoff
            with self.subTest(clock=clock), self.assertRaises(h.BrowserHostError): h.run_worker(self.c, port)
            self.assertNotIn('consume', [x[0] for x in port.calls])

    def test_missing_marker_wait_is_original_cleanup_bounded(self):
        self.c['started'] = 1; self.c['deadline'] = 3600001; self.c['cleanupAt'] = 3420001
        self.port.wall = self.c['cleanupAt'] - 100
        self.port.alter = lambda value: {**value, 'waiting': None}
        with self.assertRaises(h.BrowserHostError): h.run_worker(self.c, self.port)
        self.assertNotIn('handoff', [x[0] for x in self.port.calls])

    def test_unknown_issuance_or_consumer_or_record_failure_not_retried(self):
        for phase in ['handoff', 'consume', 'record']:
            port = FakePort(self.c)
            original = getattr(port, phase)
            def fail(*args, original=original): original(*args); raise TimeoutError('synthetic private error')
            setattr(port, phase, fail)
            with self.subTest(phase=phase), self.assertRaises(TimeoutError): h.run_worker(self.c, port)
            self.assertEqual([x[0] for x in port.calls].count(phase), 1)

    def test_action_time_preflight_failure_stops_before_issuance_or_private_node_frame(self):
        for at in [1,2]:
            port=FakePort(self.c); checks=[]
            def preflight(seconds):
                checks.append(seconds)
                if len(checks)==at: raise h.BrowserHostError('Synthetic changed runtime/Core tree')
            port.preflight=preflight
            with self.subTest(at=at),self.assertRaises(h.BrowserHostError):h.run_worker(self.c,port)
            self.assertNotIn('consume',[x[0] for x in port.calls])
            self.assertEqual([x[0] for x in port.calls].count('handoff'),at-1)

    def test_malformed_or_false_proof_no_write(self):
        original = self.port.consume
        def consume(*args):
            proof = original(*args); proof['checks']['ordinaryLoginSucceeded'] = False; return proof
        self.port.consume = consume
        with self.assertRaises(h.BrowserHostError): h.run_worker(self.c, self.port)
        self.assertNotIn('record', [x[0] for x in self.port.calls])

    def test_wrong_proof_digest_or_replayed_ack_never_claims_completion(self):
        for key, value in [('proofSha256', '0'*64), ('replayed', True)]:
            port = FakePort(self.c); original = port.record
            def record(*args): result = original(*args); result[key] = value; return result
            port.record = record
            with self.subTest(key=key), self.assertRaises(h.BrowserHostError): h.run_worker(self.c, port)

    def test_private_frames_duplicate_partial_extra_lines_and_oversize_rejected(self):
        for raw in [b'{"a":1,"a":2}\n', b'{}', b'{}\n{}\n', b'{"x":NaN}\n', b' '*4096+b'\n']:
            with self.subTest(raw=raw[:20]), self.assertRaises((ValueError, h.BrowserHostError)): h.parse(raw)

    def test_environment_drops_browser_node_debug_and_ambient_connection_settings(self):
        env = h.safe_env({'DEBUG': '*', 'PWDEBUG': '1', 'NODE_OPTIONS': '--inspect=1234', 'NODE_DEBUG': '*',
            'DEBUG_FILE':'synthetic-debug-file', 'npm_config_pwdebug':'1', 'npm_package_config_pwdebug':'1',
            'CHROME_LOG_FILE': 'secret.log', 'DATABASE_URL': 'private', 'PATH': 'foreign', 'SystemRoot': 'public'})
        self.assertEqual(env, {'SystemRoot': 'public', 'PATH': r'C:\Windows\System32;C:\Windows'})

    def test_metadata_reader_static_has_no_credential_or_parameterized_file_access(self):
        compile(h.METADATA_READER, '<metadata-reader>', 'exec')
        self.assertNotIn('credentials', h.METADATA_READER)
        self.assertNotIn('password', h.METADATA_READER)
        self.assertIn('os.O_NOFOLLOW', h.METADATA_READER)
        self.assertIn("m.private_read(r/'broker-control.private.json')", h.METADATA_READER)

    def test_worker_refuses_before_gate_with_only_fixed_error_no_children(self):
        result = subprocess.run([sys.executable, '-B', str(SOURCE), '--worker'], input=b'BAD\nprivate-synthetic\n',
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5)
        self.assertNotEqual(result.returncode, 0); self.assertEqual(result.stdout, b'')
        self.assertEqual(result.stderr.splitlines(), [b'NATIVE_BROWSER_UNRESOLVED; no automatic retry.'])


class Gate(io.BytesIO):
    def __init__(self, events): super().__init__(); self.events = events
    def write(self, data): self.events.append(('gate', data)); return super().write(data)


class Child:
    def __init__(self, events, scope='b'*64):
        self.events = events; self.stdin = Gate(events); self.returncode = None; self._handle = 987654
        self.stdout = io.BytesIO(h.compact({'status': 'recorded', 'scopeSha256': scope,
            'proofRecorded': True, 'contextClosed': True, 'privateInputPersisted': False}))
    def poll(self): return self.returncode
    def kill(self): self.events.append(('kill-exact-child', self._handle)); self.returncode = 1
    def wait(self, timeout): self.events.append(('wait', timeout)); self.returncode = self.returncode or 0


class JobTests(unittest.TestCase):
    def test_exact_handle_assignment_precedes_go_and_config_and_close_is_idempotent(self):
        events = []; child = Child(events)
        class Job:
            def assign(self, process): events.append(('assign', process._handle))
            def close(self): events.append(('close-job',))
        def popen(args, **kwargs):
            self.assertEqual(args[0], h.PYTHON); self.assertEqual(args[-1], '--worker')
            self.assertEqual(kwargs['stderr'], subprocess.DEVNULL)
            self.assertNotIn('b'*64, repr(args)); events.append(('popen',)); return child
        job = h.BrowserJob(config(), job_factory=Job, popen=popen)
        self.assertEqual([e[0] for e in events], ['popen', 'assign', 'gate'])
        self.assertTrue(events[2][1].startswith(b'GO\n'))
        job.check(); self.assertTrue(job.finish(1)['proofRecorded']); job.close()
        self.assertEqual([e[0] for e in events].count('close-job'), 1)

    def test_assignment_failure_never_releases_gate_and_kills_exact_unassigned_child(self):
        events = []; child = Child(events)
        class Job:
            def assign(self, process): events.append(('assign', process._handle)); raise OSError('private fixture')
            def close(self): events.append(('close-job',))
        with self.assertRaises(h.BrowserHostError): h.BrowserJob(config(), job_factory=Job, popen=lambda *_a, **_k: child)
        self.assertNotIn('gate', [e[0] for e in events]); self.assertIn(('kill-exact-child', child._handle), events)

    def test_bad_config_rejected_before_job_or_process(self):
        c = config(); c['deadline'] += 1
        def forbidden(*_a, **_k): self.fail('must not start')
        with self.assertRaises(h.BrowserHostError): h.BrowserJob(c, job_factory=forbidden, popen=forbidden)

    def test_failed_worker_health_or_nonzero_exit_never_claims_safe_completion(self):
        events = []; child = Child(events)
        class Job:
            def assign(self, process): pass
            def close(self): events.append(('closed',))
        job = h.BrowserJob(config(), job_factory=Job, popen=lambda *_a, **_k: child)
        child.returncode = 1
        with self.assertRaises(h.BrowserHostError): job.check()
        with self.assertRaises(h.BrowserHostError): job.finish(1)
        job.close(); self.assertIn(('closed',), events)

    def test_completion_with_private_extra_or_false_closed_flag_is_rejected(self):
        for field, value in [('password', 'synthetic-never-output'), ('contextClosed', False)]:
            events = []; child = Child(events)
            class Job:
                def assign(self, process): pass
                def close(self): pass
            made = json.loads(child.stdout.getvalue()); made[field] = value; child.stdout = io.BytesIO(h.compact(made))
            job = h.BrowserJob(config(), job_factory=Job, popen=lambda *_a, **_k: child)
            with self.subTest(field=field), self.assertRaises(h.BrowserHostError): job.finish(1)
            job.close()


@unittest.skipUnless(os.name == 'posix', 'Protected POSIX synthetic metadata files only')
class MetadataReaderTests(unittest.TestCase):
    def test_core_tree_manifest_matches_exact_algorithm_and_rejects_any_symlink(self):
        with tempfile.TemporaryDirectory(prefix='public-core-tree-fixture-') as directory:
            root=Path(directory);(root/'sub').mkdir();(root/'index.mjs').write_bytes(b'public fixture\n');(root/'sub/a').write_bytes(b'abc')
            rows=[[p.relative_to(root).as_posix(),len(p.read_bytes()),h.sha(p.read_bytes())] for p in root.rglob('*') if p.is_file()]
            expected=h.sha(json.dumps(sorted(rows),ensure_ascii=False,separators=(',',':')).encode())
            def run():return subprocess.run([sys.executable,'-B','-c',h.CORE_ATTEST,str(root)],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=5)
            result=run();self.assertEqual(result.returncode,0);self.assertEqual(h.parse(result.stdout)['sha256'],expected)
            (root/'linked').symlink_to(root/'index.mjs')
            self.assertNotEqual(run().returncode,0)

    def test_fixed_reader_uses_no_follow_private_read_and_never_reads_credential_sentinel(self):
        with tempfile.TemporaryDirectory(prefix='browser-metadata-fixture-') as directory:
            root = Path(directory); root.chmod(0o700); (root/'adapter-code').mkdir(mode=0o700)
            helper = b'''from pathlib import Path
import os,stat
def private_read(p):
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
 try:
  s=os.fstat(fd)
  if stat.S_IMODE(s.st_mode)!=0o600:raise ValueError()
  return os.read(fd,1048576)
 finally:os.close(fd)
'''
            def write(name, value):
                p=root/name; p.write_bytes(value if isinstance(value,bytes) else h.compact(value)); p.chmod(0o600)
            write('adapter-code/week1-auth-rehearsal.py', helper)
            c=config(); control={k:c[k] for k in ['started','deadline','cleanupAt']}
            control.update({k:c['binding'][k] for k in ['profile','project','scopeSha256','sourceLockSha256']})
            control.update(hostDriver=c['binding'],state='reserved')
            write('broker-control.private.json', control)
            write('adapter-code/week1-auth-source-lock.json', {'sources':{}})
            write('credentials.json', {'password':'SYNTHETIC_SENTINEL_MUST_NOT_LEAVE_READER'})
            result=subprocess.run([sys.executable,'-B','-c',h.METADATA_READER,str(root),h.sha(helper)],
                stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=5)
            self.assertEqual(result.returncode,0)
            self.assertNotIn(b'SYNTHETIC_SENTINEL',result.stdout)
            value=h.parse(result.stdout,1048576)
            self.assertIsNone(value['waiting']);self.assertIsNone(value['ack']);self.assertFalse(value['cleanupStarted'])
            # A symlink to a private file cannot stand in for the marker.
            (root/'browser-awaiting.private.json').symlink_to(root/'credentials.json')
            rejected=subprocess.run([sys.executable,'-B','-c',h.METADATA_READER,str(root),h.sha(helper)],
                stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=5)
            self.assertNotEqual(rejected.returncode,0);self.assertEqual(rejected.stdout,b'')


if __name__ == '__main__': unittest.main()
