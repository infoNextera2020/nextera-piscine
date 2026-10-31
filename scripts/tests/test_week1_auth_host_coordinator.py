"""Pure protocol tests and public subprocess probes; never execute a live guard."""
from pathlib import Path
import copy
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
from datetime import datetime, timedelta, timezone

sys.dont_write_bytecode = True
source = Path(__file__).resolve().parents[1] / 'week1-auth-host-coordinator.py'
setup = importlib.util.spec_from_file_location('native_host_under_test', source)
h = importlib.util.module_from_spec(setup)
setup.loader.exec_module(h)


def spec():
    return {'hostGuardDriver': h.DRIVER, 'hostGuardExecutionPolicy': 'process-RemoteSigned',
            'scopeSha256': 'a'*64, 'sourceLockSha256': 'b'*64, 'reviewedHead': 'c'*40,
            'target': {'root': h.ROOT, 'profile': h.PROFILE, 'project': h.PROJECT},
            'images': {name: 'fixture.invalid/'+name+'@sha256:'+'d'*64 for name in
                       ['db','auth','rest','storage','imgproxy','meta','studio','api-gw']}}


class SessionTests(unittest.TestCase):
    def setUp(self):
        self.spec = spec()
        self.bound = h.binding(self.spec, 'e'*64)
        self.guard_sha = 'f'*64
        self.calls = []
        self.probe = {'ready': True, 'nonce': self.bound['session'], 'engineId': 'fixture-engine-123',
                      'dockerSha': '1'*64, 'childPid': 123, 'childStartedTicks': 456,
                      'childExited': True, 'guardSha256': self.guard_sha}
        self.guard = {'profile': h.PROFILE, 'scopeSha256': self.bound['scopeSha256'],
                      'engineId': self.probe['engineId'], 'pid': 789, 'startedTicks': 1000,
                      'cache': r'C:\fixture-owned-cache', 'manifestSha256': '2'*64,
                      'guardSourceSha256': self.guard_sha, 'ready': True}
        self.closed = {key: self.guard[key] for key in ['pid','startedTicks','scopeSha256','manifestSha256','guardSourceSha256']}
        self.closed['guardStopped'] = True
        self.answers = [self.probe, self.guard, self.closed]
        def run(args, **kwargs):
            self.calls.append((args, kwargs))
            return json.dumps(self.answers[len(self.calls)-1]).encode()
        self.session = h.NativeSession(self.bound, self.spec, self.guard_sha, run=run, verify_sources=lambda:True)

    def probe_request(self):
        return h.frame(self.bound, 1, 'probe', {'linuxEngineId': self.probe['engineId'],
            'guardSha256': self.guard_sha, 'coordinatorSha256': h.digest(source.read_bytes())})

    def arm_request(self):
        now = datetime.now(timezone.utc)
        manifest = {'version': 1, **{key: self.bound[key] for key in ['profile','root','project','scopeSha256','sourceLockSha256','reviewedHead']},
            'engineId': self.probe['engineId'], 'dockerCliSha256': self.probe['dockerSha'], 'services': self.spec['images'],
            'startedUtc': now.isoformat(), 'deadlineUtc': (now+timedelta(seconds=3600)).isoformat(),
            'cleanupAtUtc': (now+timedelta(seconds=3420)).isoformat(), 'baselineContainerIds': []}
        raw = json.dumps(manifest, separators=(',', ':')).encode()
        return h.frame(self.bound, 2, 'arm', {'manifest': manifest, 'manifestSha256': h.digest(raw)})

    def test_only_original_order_and_bound_source_can_arm_and_close(self):
        self.session.handle(self.probe_request())
        self.session.handle(self.arm_request())
        result = self.session.handle(h.frame(self.bound, 3, 'complete', {'linuxCleanupVerified': True}))
        self.assertTrue(result['result']['guardStopped'])
        self.assertEqual([call[0][7] for call in self.calls], ['-Probe', '-Install', '-Complete'])
        self.assertTrue(all('Bypass' not in call[0] and 'Set-ExecutionPolicy' not in call[0] for call in self.calls))

    def test_nonce_scope_source_phase_sequence_extra_and_secret_fields_reject_before_dispatch(self):
        for field, value in [('sequence', 2), ('operation','arm'), ('version',True), ('extra','unexpected')]:
            request = self.probe_request(); request[field] = value
            with self.subTest(field=field), self.assertRaises(h.DriverError):
                self.session.handle(request)
        for field in ['session','scopeSha256','sourceLockSha256','reviewedHead','root']:
            request = self.probe_request(); request['binding'] = {**request['binding'],field:'foreign'}
            with self.subTest(binding=field), self.assertRaises(h.DriverError):
                self.session.handle(request)
        request = self.probe_request(); request['payload']['password'] = 'must-not-travel'
        with self.assertRaises(h.DriverError): self.session.handle(request)
        self.assertEqual(self.calls, [])

    def test_failed_probe_or_installer_unknown_outcome_is_consumed_never_replayed(self):
        self.session.run = lambda *_a, **_k: (_ for _ in ()).throw(TimeoutError('public fake timeout'))
        with self.assertRaises(TimeoutError): self.session.handle(self.probe_request())
        with self.assertRaises(h.DriverError): self.session.handle(self.probe_request())
        self.assertTrue(self.session.failed)
        fresh = h.NativeSession(self.bound, self.spec, self.guard_sha, run=lambda *_a,**_k: json.dumps(self.probe).encode(), verify_sources=lambda:True)
        fresh.handle(self.probe_request())
        fresh.run = self.session.run
        with self.assertRaises(TimeoutError): fresh.handle(self.arm_request())
        self.assertTrue(fresh.arm_attempted)
        with self.assertRaises(h.DriverError): fresh.handle(self.arm_request())

    def test_mismatched_actual_engine_source_child_or_ready_cannot_arm(self):
        for key, value in [('engineId','foreign'),('guardSha256','0'*64),('childPid',0),('childStartedTicks',0),('childExited',False),('ready',False)]:
            answer = {**self.probe,key:value}
            candidate = h.NativeSession(self.bound, self.spec, self.guard_sha, run=lambda *_a,**_k: json.dumps(answer).encode(), verify_sources=lambda:True)
            with self.subTest(key=key), self.assertRaises(h.DriverError): candidate.handle(self.probe_request())

    def test_changed_deadline_images_or_unverified_linux_cleanup_cannot_stop_native_guard(self):
        self.session.handle(self.probe_request())
        bad = self.arm_request(); bad['payload']['manifest']['deadlineUtc'] = bad['payload']['manifest']['cleanupAtUtc']
        raw = json.dumps(bad['payload']['manifest'], separators=(',', ':')).encode()
        bad['payload']['manifestSha256'] = h.digest(raw)
        with self.assertRaises(h.DriverError): self.session.handle(bad)
        self.assertEqual(len(self.calls), 1)
        self.setUp(); self.session.handle(self.probe_request()); self.session.handle(self.arm_request())
        with self.assertRaises(h.DriverError): self.session.handle(h.frame(self.bound,3,'complete',{'linuxCleanupVerified':False}))
        self.assertEqual(len(self.calls), 2)

    def test_changed_pid_creation_source_or_ack_never_claims_native_closure(self):
        for key, value in [('pid',999),('startedTicks',1001),('guardSourceSha256','3'*64),('guardStopped',False)]:
            self.setUp(); self.answers[2] = {**self.closed,key:value}
            self.session.handle(self.probe_request()); self.session.handle(self.arm_request())
            with self.subTest(key=key), self.assertRaises(h.DriverError):
                self.session.handle(h.frame(self.bound,3,'complete',{'linuxCleanupVerified':True}))

    def test_source_changed_before_dispatch_cannot_start_native_process(self):
        self.session.verify_sources = lambda:False
        with self.assertRaises(h.DriverError): self.session.handle(self.probe_request())
        self.assertEqual(self.calls, [])

    def test_original_native_monotonic_deadline_cannot_be_renewed_by_wall_time(self):
        self.session.deadline = datetime.now(timezone.utc)+timedelta(hours=1)
        self.session.monotonic_end = h.time.monotonic()-1
        with self.assertRaises(h.DriverError): self.session.remaining(30)

    def test_only_exact_four_preserved_dirty_paths_are_allowed_as_structured_names(self):
        h.validate_changed_paths(sorted(h.UNRELATED_PATHS))
        h.validate_changed_paths([])
        for paths in [['scripts/unreviewed.py'],['apps/web/public/ASSETS.md\nforeign'],
                      ['docs/RELEASE_CANDIDATE_001_REPORT.md foreign'], 'quoted porcelain output', [None]]:
            with self.subTest(paths=paths), self.assertRaises(h.DriverError): h.validate_changed_paths(paths)

    def test_frames_reject_duplicate_partial_large_nul_and_nonfinite_material(self):
        for data in [b'{"a":1,"a":2}\n',b'{}',b'{"x":"\\u0000"}\n',b'{"n":NaN}\n',b' '*h.MAX_FRAME+b'\n']:
            with self.subTest(data=data[:30]), self.assertRaises((h.DriverError,ValueError)): h.decode(data)
        with self.assertRaises(h.DriverError): h.encode({'password': '\x00'})


@unittest.skipUnless(os.name == 'posix', 'POSIX inherited pipe identity test')
class LinuxPipeTests(unittest.TestCase):
    def test_actual_public_metadata_reader_keeps_structured_tracked_untracked_names(self):
        compile(h.PUBLIC_PACKET_READER, '<public-source-reader>', 'exec')
        repo = Path(__file__).resolve().parents[2]
        with tempfile.TemporaryDirectory(prefix='public-metadata-reader-test-') as directory:
            fixture = Path(directory)
            (fixture/'spec.json').write_text('{"fixtureOnly":true}')
            (fixture/'source-lock.json').write_text('{"sources":{}}')
            result = subprocess.run([sys.executable,'-c',h.PUBLIC_PACKET_READER,str(repo),
                str(fixture/'spec.json'),str(fixture/'source-lock.json')],capture_output=True,text=True,timeout=10)
            self.assertEqual(result.returncode,0,result.stderr)
            public = json.loads(result.stdout)
            self.assertIsInstance(public['changedPaths'],list)
            self.assertTrue(all(isinstance(path,str) for path in public['changedPaths']))
            self.assertEqual(public['spec'],{'fixtureOnly':True})

    def test_independent_duplicate_reader_observes_eof_without_consuming_rpc_bytes(self):
        read, write = os.pipe(); duplicate = os.dup(read)
        try:
            identity = h.pipe_identity(read)
            self.assertEqual(h.pipe_identity(duplicate), identity)
            os.write(write,b'public reply\n')
            self.assertFalse(h.pipe_closed(duplicate,identity))
            os.close(write); write = None
            self.assertTrue(h.pipe_closed(duplicate,identity))
            self.assertEqual(os.read(read,100), b'public reply\n')
            self.assertTrue(h.pipe_closed(duplicate,{'device':-1,'inode':-1}))
        finally:
            os.close(read); os.close(duplicate)
            if write is not None: os.close(write)

    def test_client_unknown_timeout_consumes_operation_and_never_resends(self):
        read, peer_write = os.pipe(); peer_read, write = os.pipe()
        try:
            client = h.HostClient(h.binding(spec(),'e'*64), read, write)
            with self.assertRaises(h.DriverError): client.exchange('probe',{},timeout=.02)
            first = os.read(peer_read,h.MAX_FRAME)
            with self.assertRaises(h.DriverError): client.exchange('probe',{},timeout=.02)
            self.assertEqual(h.decode(first)['sequence'],1)
            os.set_blocking(peer_read,False)
            with self.assertRaises(BlockingIOError): os.read(peer_read,1)
        finally:
            for fd in [read,peer_write,peer_read,write]: os.close(fd)


@unittest.skipUnless(os.name == 'nt', 'Requires fixed installed native Windows Python; no Linux PE fallback')
class NativePublicProbeTests(unittest.TestCase):
    def test_real_native_windows_wsl_engine_and_parent_death_public_probe(self):
        repo = os.environ.get('WEEK1_PUBLIC_PROBE_REPO')
        if not repo: self.skipTest('Explicit public probe source directory required')
        result = h.public_probe(repo)
        self.assertEqual(result['engineId'],result['wslEngineId'])
        self.assertTrue(result['actualParentLossCancelsOwnedPhase'])
        self.assertFalse(result['wslInteropRequired'])
        self.assertFalse(result['liveRemoteSignedProbeExecuted'])
        self.assertFalse(result['runtimeCreated'])


if __name__ == '__main__':
    unittest.main()
