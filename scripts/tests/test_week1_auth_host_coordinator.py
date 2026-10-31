"""Pure protocol tests and public subprocess probes; never execute a live guard."""
from pathlib import Path
import ast
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
from types import SimpleNamespace
from unittest.mock import patch

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


class FakeBrowser:
    def __init__(self, config):
        self.config = config; self.checked = 0; self.finished = False; self.closed = False
        self.fail = False
    def check(self):
        self.checked += 1
        if self.fail: raise h.DriverError('Synthetic worker failed')
    def finish(self, seconds):
        self.check(); self.finished = True; self.close()
    def close(self, seconds=5):
        self.closed = True
        return {'jobClosed': True, 'activeProcessesZero': True, 'workerExited': True}


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
        self.session = h.NativeSession(self.bound, self.spec, self.guard_sha, run=run, verify_sources=lambda:True,
            browser_factory=FakeBrowser, browser_config={'repo':'fixture-only'})

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
        result = self.session.handle(h.frame(self.bound, 3, 'complete', {'linuxCleanupVerified': True, 'authAssertionsPassed': True}))
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
        fresh = h.NativeSession(self.bound, self.spec, self.guard_sha, run=lambda *_a,**_k: json.dumps(self.probe).encode(), verify_sources=lambda:True,
            browser_factory=FakeBrowser, browser_config={'repo':'fixture-only'})
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
        with self.assertRaises(h.DriverError): self.session.handle(h.frame(self.bound,3,'complete',{'linuxCleanupVerified':False, 'authAssertionsPassed':False}))
        self.assertEqual(len(self.calls), 2)

    def test_changed_pid_creation_source_or_ack_never_claims_native_closure(self):
        for key, value in [('pid',999),('startedTicks',1001),('guardSourceSha256','3'*64),('guardStopped',False)]:
            self.setUp(); self.answers[2] = {**self.closed,key:value}
            self.session.handle(self.probe_request()); self.session.handle(self.arm_request())
            with self.subTest(key=key), self.assertRaises(h.DriverError):
                self.session.handle(h.frame(self.bound,3,'complete',{'linuxCleanupVerified':True, 'authAssertionsPassed':True}))

    def test_source_changed_before_dispatch_cannot_start_native_process(self):
        self.session.verify_sources = lambda:False
        with self.assertRaises(h.DriverError): self.session.handle(self.probe_request())
        self.assertEqual(self.calls, [])

    def test_original_native_monotonic_deadline_cannot_be_renewed_by_wall_time(self):
        self.session.deadline = datetime.now(timezone.utc)+timedelta(hours=1)
        self.session.monotonic_end = h.time.monotonic()-1
        with self.assertRaises(h.DriverError): self.session.remaining(30)

    def test_arm_starts_worker_before_ack_with_original_scope_and_cleanup_clock(self):
        self.session.handle(self.probe_request())
        request = self.arm_request()
        result = self.session.handle(request)
        self.assertEqual(result['status'], 'ok')
        worker = self.session.browser
        self.assertEqual(worker.checked, 1)
        self.assertEqual(worker.config['binding'], self.bound)
        self.assertEqual(worker.config['cache'], self.guard['cache'])
        self.assertEqual(worker.config['manifestSha256'], self.guard['manifestSha256'])
        self.assertEqual(worker.config['deadline'] - worker.config['started'], 3600000)
        self.assertEqual(worker.config['deadline'] - worker.config['cleanupAt'], 180000)

    def test_missing_browser_configuration_or_start_failure_fails_arm_after_guard_not_replayed(self):
        for failure in ['config', 'start']:
            self.setUp(); self.session.handle(self.probe_request())
            if failure == 'config': self.session.browser_config = None
            else: self.session.browser_factory = lambda _: (_ for _ in ()).throw(h.DriverError('synthetic start failure'))
            with self.subTest(failure=failure), self.assertRaises(h.DriverError): self.session.handle(self.arm_request())
            self.assertTrue(self.session.failed); self.assertIsNotNone(self.session.guard)
            self.assertEqual(len(self.calls), 2)

    def test_failed_assertions_still_close_owned_job_and_exact_guard_after_verified_linux_cleanup(self):
        self.session.handle(self.probe_request()); self.session.handle(self.arm_request())
        self.session.browser.fail = True
        result = self.session.handle(h.frame(self.bound, 3, 'complete',
            {'linuxCleanupVerified':True, 'authAssertionsPassed':True}))['result']
        self.assertTrue(self.session.browser.closed)
        self.assertEqual(len(self.calls), 3)
        self.assertTrue(result['guardStopped'])
        self.assertTrue(result['browserJobClosed'])
        self.assertFalse(result['authAssertionsPassed'])

    def test_idle_parent_pipe_wait_checks_browser_failure(self):
        import io
        with self.assertRaises(h.DriverError):
            h.read_line_bounded(io.BytesIO(b'{}\n'), 1,
                check=lambda: (_ for _ in ()).throw(h.DriverError('worker failed')))

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


class FrozenBrowserSourceTests(unittest.TestCase):
    def setUp(self):
        self.host_source = source.with_name('week1-auth-browser-host.py')
        self.sha = h.digest(self.host_source.read_bytes())
        self.expected_repo = '/home/anas/.local/share/01coding-source/auth-source-browser-smtp1-clean1'

    def test_actual_verified_host_accepts_only_exact_new_frozen_repo_without_runtime(self):
        helper = h.browser_source_for_repo(self.expected_repo, self.sha)
        self.assertEqual(helper.REPO, self.expected_repo)
        self.assertTrue(callable(helper.start))
        for repo in ['/home/anas/nextera-piscine', '/home/anas/.local/share/01coding-source/auth-source-smtp1-clean1',
                     self.expected_repo + '/', self.expected_repo + '/..']:
            with self.subTest(repo=repo), self.assertRaises(h.DriverError): h.browser_source_for_repo(repo, self.sha)

    def test_host_hash_mismatch_rejected_before_import(self):
        with self.assertRaises(h.DriverError): h.browser_source_for_repo(self.expected_repo, '0'*64)

    def test_actual_execute_rejects_wrong_repo_before_probe_guard_job_or_keys(self):
        class PublicProbeReached(Exception): pass
        with tempfile.TemporaryDirectory(prefix='public-source-admission-fixture-') as directory:
            fixture = Path(directory)
            coordinator = fixture / source.name; coordinator.write_bytes(source.read_bytes())
            host = fixture / 'week1-auth-browser-host.py'; host.write_bytes(self.host_source.read_bytes())
            consumer = fixture / 'week1-auth-browser-consumer.mjs'; consumer.write_bytes(b'public fake consumer source')
            guard = fixture / 'week1-auth-host-guard.ps1'; guard.write_bytes(b'public fake guard source')
            sources = {'scripts/week1-auth-host-coordinator.py': h.digest(coordinator.read_bytes()),
                'scripts/week1-auth-browser-host.py': h.digest(host.read_bytes()),
                'scripts/week1-auth-browser-consumer.mjs': h.digest(consumer.read_bytes()),
                'scripts/week1-auth-host-guard.ps1': h.digest(guard.read_bytes())}
            public = {'spec': {'sourceLockSha256': 'b'*64, 'scopeSha256': 'a'*64, 'reviewedHead': 'c'*40},
                'lock': {'sources': sources}, 'lockSha': 'b'*64, 'head': 'c'*40,
                'sourceHashes': sources, 'changedPaths': []}
            def paths(value): return guard if str(value) == h.GUARD else Path(value)
            for repo in ['/home/anas/nextera-piscine', '/home/anas/.local/share/01coding-source/auth-source-smtp1-clean1',
                         self.expected_repo]:
                args = SimpleNamespace(repo=repo, template='/public-fixture/template', spec='/public-fixture/spec.json',
                    source_lock='/public-fixture/lock.json', source_lock_sha256='b'*64,
                    approval_receipt='/public-fixture/synthetic-approval.json', owner_message_id='Sentinel_'+'e'*32,
                    owner_approved_at=datetime.now(timezone.utc).isoformat(), scope_sha256='a'*64,
                    browser_context='/public-fixture/context.json')
                with self.subTest(repo=repo), patch.object(h, '__file__', str(coordinator)), patch.object(h, 'Path', paths), \
                        patch.object(h, 'os', SimpleNamespace(name='nt', path=os.path)), \
                        patch.object(h, 'sys', SimpleNamespace(executable=h.WINDOWS_PYTHON)), \
                        patch.object(h, 'native_run', return_value=json.dumps(public).encode()) as metadata, \
                        patch.object(h, 'public_probe', side_effect=PublicProbeReached) as probe, \
                        patch.object(h, 'host_command') as command, patch.object(h, 'NativeSession') as session, \
                        patch.object(h.subprocess, 'Popen') as start:
                    if repo == self.expected_repo:
                        with self.assertRaises(PublicProbeReached): h.execute(args)
                        probe.assert_called_once_with(repo)
                    else:
                        with self.assertRaisesRegex(h.DriverError, 'exact frozen source repository'): h.execute(args)
                        probe.assert_not_called()
                    metadata.assert_called_once()  # Public source metadata only; no private read/dispatch.
                    command.assert_not_called(); session.assert_not_called(); start.assert_not_called()

    def test_production_execute_admits_host_repo_before_public_probe_or_guard_job_key_dispatch(self):
        tree = ast.parse(source.read_text())
        execute = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'execute')
        calls = {name: [node.lineno for node in ast.walk(execute) if isinstance(node, ast.Call) and
            isinstance(node.func, ast.Name) and node.func.id == name] for name in
            ['browser_source_for_repo', 'public_probe', 'NativeSession']}
        self.assertEqual(len(calls['browser_source_for_repo']), 1)
        admission = calls['browser_source_for_repo'][0]
        self.assertLess(admission, min(calls['public_probe']))
        self.assertLess(admission, min(calls['NativeSession']))
        subprocess_starts = [node.lineno for node in ast.walk(execute) if isinstance(node, ast.Call) and
            isinstance(node.func, ast.Attribute) and node.func.attr == 'Popen']
        self.assertTrue(subprocess_starts)
        self.assertLess(admission, min(subprocess_starts))
        session = next(node for node in ast.walk(execute) if isinstance(node, ast.Call) and
            isinstance(node.func, ast.Name) and node.func.id == 'NativeSession')
        factory = next(keyword.value for keyword in session.keywords if keyword.arg == 'browser_factory')
        self.assertEqual(ast.unparse(factory), 'browser_host.start')


@unittest.skipUnless(os.name == 'posix', 'POSIX inherited pipe identity test')
class LinuxPipeTests(unittest.TestCase):
    def test_actual_public_metadata_reader_keeps_structured_tracked_untracked_names(self):
        compile(h.PUBLIC_PACKET_READER, '<public-source-reader>', 'exec')
        repo = Path(os.environ.get('WEEK1_UNIT_SOURCE_REPO', Path(__file__).resolve().parents[2]))
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



@unittest.skipUnless(os.name == 'posix', 'Controller HostClient uses POSIX inherited pipes')
class FailureRecoveryTests(unittest.TestCase):
    def fixture(self):
        case = SessionTests(); case.setUp()
        return case

    def cleanup_frame(self, bound, verified=True):
        incoming, owner = os.pipe(); output, writer = os.pipe()
        try:
            client = h.HostClient(bound, incoming, writer); client.sequence = 2
            os.close(owner); owner = None
            self.assertFalse(client.live())
            if not verified:
                with self.assertRaises(h.DriverError):
                    client.send_cleanup({'linuxCleanupVerified': False, 'authAssertionsPassed': False})
                self.assertEqual(client.sequence, 2)
                return None
            client.send_cleanup({'linuxCleanupVerified': True, 'authAssertionsPassed': False})
            value = h.decode(os.read(output, h.MAX_FRAME))
            with self.assertRaises(h.DriverError):
                client.send_cleanup({'linuxCleanupVerified': True, 'authAssertionsPassed': False})
            return value
        finally:
            for fd in (incoming, owner, output, writer):
                if fd is not None: os.close(fd)

    def test_actual_browser_job_client_and_native_session_close_after_worker_exit_and_eof(self):
        import io
        host_path = source.with_name('week1-auth-browser-host.py')
        host = h.browser_helpers(h.digest(host_path.read_bytes()))
        for point in ('arm_ack', 'stack'):
            case = self.fixture(); events = []
            class Worker:
                def __init__(self):
                    self.stdin = io.BytesIO(); self._handle = 24680
                    self.returncode = 1 if point == 'arm_ack' else None
                    event = host.failure(host.BrowserHostError('retry_exhausted', exit_code=1), 'metadata')
                    self.stdout = io.BytesIO(host.compact({'status': 'failed', 'failure': event}))
                def poll(self): return self.returncode
                def wait(self, timeout): events.append('worker-reaped'); return self.returncode
            worker = Worker()
            class Job:
                def assign(self, child): self.asserted = child._handle; events.append(('assign', child._handle))
                def stop_and_verify(self, left): events.append('active-zero'); return left() > 0
                def close(self): events.append('job-closed')
            case.session.browser_config = {'repo':host.REPO,'helperSha256':'1'*64,
                'brokerSha256':'2'*64,'consumerSha256':'3'*64,'hostSha256':h.digest(host_path.read_bytes())}
            case.session.browser_factory = lambda c: host.BrowserJob(c, job_factory=Job, popen=lambda *_a,**_k:worker)
            final = self.cleanup_frame(case.bound)
            frames = [case.probe_request(), case.arm_request(), final]
            if point == 'stack':
                case.session.handle(frames.pop(0)); case.session.handle(frames.pop(0))
                worker.returncode = 1
            class Controller:
                stdin, stdout = io.BytesIO(), io.BytesIO()
                returncode = None
                def wait(self, timeout): self.returncode = 0
            controller = Controller()
            def read(stream, timeout, check=None, pending=None):
                if check: check()
                return frames.pop(0)
            with self.subTest(point=point), patch.object(h, 'read_line_bounded', side_effect=read), \
                    patch.object(h, 'begin_line_read', return_value=object()):
                result = h.serve_controller(controller, case.session)
            self.assertTrue(controller.stdin.closed)
            self.assertTrue(result['guardStopped']); self.assertTrue(result['browserJobClosed'])
            self.assertFalse(result['authAssertionsPassed'])
            self.assertEqual(case.session.diagnostic['category'], 'retry_exhausted')
            self.assertEqual(events.count('active-zero'), 1)
            self.assertEqual(events.count('job-closed'), 1)
            self.assertEqual([row[0][7] for row in case.calls], ['-Probe','-Install','-Complete'])

    def test_unverified_job_linux_cleanup_or_changed_binding_never_complete_guard(self):
        case = self.fixture()
        case.session.handle(case.probe_request()); case.session.handle(case.arm_request())
        case.session.browser.close = lambda *_a: {'jobClosed':True,'activeProcessesZero':False,'workerExited':True}
        with self.assertRaises(h.DriverError):
            case.session.handle(self.cleanup_frame(case.bound))
        self.assertEqual(len(case.calls), 2)
        self.cleanup_frame(case.bound, verified=False)
        case = self.fixture()
        case.session.handle(case.probe_request()); case.session.handle(case.arm_request())
        frame = self.cleanup_frame(case.bound); frame['binding'] = {**case.bound, 'session':'0'*64}
        with self.assertRaises(h.DriverError): case.session.handle(frame)
        self.assertEqual(len(case.calls), 2)

    def test_failure_categories_reject_private_or_unknown_fields(self):
        raw = {'version':1,'phase':'metadata','component':'native_browser','category':'metadata_timeout',
               'exceptionKind':'browser','exitCode':1,'signal':None}
        self.assertEqual(h.browser_failure(raw), raw)
        for changed in ({**raw,'password':'PRIVATE_SENTINEL'}, {**raw,'category':'PRIVATE_SENTINEL'},
                        {**raw,'exceptionKind':'PRIVATE_SENTINEL'}, {**raw,'exitCode':True}):
            self.assertNotIn('PRIVATE_SENTINEL', json.dumps(h.browser_failure(changed)))
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(h.safe_error(ValueError('PRIVATE_SENTINEL'))))



class NativeFailureFlowTests(unittest.TestCase):
    def test_native_source_modules_close_failed_worker_without_assertion_success(self):
        import io
        case = SessionTests(); case.setUp()
        host_path = source.with_name('week1-auth-browser-host.py')
        host = h.browser_helpers(h.digest(host_path.read_bytes()))
        events = []
        class Worker:
            def __init__(self):
                self.stdin, self._handle, self.returncode = io.BytesIO(), 13579, None
                self.stdout = io.BytesIO(host.compact({'status':'failed','failure':
                    host.failure(host.BrowserHostError('metadata_timeout', exit_code=1), 'metadata')}))
            def poll(self): return self.returncode
            def wait(self, timeout): events.append('root-exited'); return self.returncode
        worker = Worker()
        class Job:
            def assign(self, child): events.append(('exact-handle', child._handle))
            def stop_and_verify(self, left): events.append('active-zero'); return left() > 0
            def close(self): events.append('job-closed')
        case.session.browser_config = {'repo':host.REPO,'helperSha256':'1'*64,'brokerSha256':'2'*64,
            'consumerSha256':'3'*64,'hostSha256':h.digest(host_path.read_bytes())}
        case.session.browser_factory = lambda c: host.BrowserJob(c, job_factory=Job, popen=lambda *_a,**_k:worker)
        case.session.handle(case.probe_request()); case.session.handle(case.arm_request())
        worker.returncode = 1
        class Controller:
            stdin, stdout, returncode = io.BytesIO(), io.BytesIO(), None
            def wait(self, timeout): self.returncode = 0
        controller = Controller()
        # Linux cleanup sender is injected here. Its real inherited-FD regression
        # is separate and must run on Linux; no Windows select-on-pipe substitute.
        final = h.frame(case.bound, 3, 'complete', {'linuxCleanupVerified':True,'authAssertionsPassed':False})
        def read(stream, timeout, check=None, pending=None):
            if check: check()
            return final
        with patch.object(h, 'begin_line_read', return_value=object()), \
             patch.object(h, 'read_line_bounded', side_effect=read):
            result = h.serve_controller(controller, case.session)
        self.assertTrue(controller.stdin.closed)
        self.assertTrue(result['guardStopped']); self.assertTrue(result['browserJobClosed'])
        self.assertFalse(result['authAssertionsPassed'])
        self.assertEqual(case.session.diagnostic['category'], 'metadata_timeout')
        self.assertEqual(events.count('active-zero'), 1); self.assertEqual(events.count('job-closed'), 1)
        self.assertEqual(len(case.calls), 3)

    def test_pending_real_public_pipe_read_survives_browser_abort_without_losing_cleanup_frame(self):
        read_fd, write_fd = os.pipe()
        stream = os.fdopen(read_fd, 'rb', buffering=0)
        try:
            pending = h.begin_line_read(stream)
            event = h.browser_failure(None)
            with self.assertRaises(h.BrowserAbort):
                h.read_line_bounded(stream, 1, pending=pending,
                    check=lambda: (_ for _ in ()).throw(h.BrowserAbort(event)))
            payload = {'public':'cleanup-frame'}
            os.write(write_fd, h.encode(payload))
            self.assertEqual(h.read_line_bounded(stream, 1, pending=pending), payload)
        finally:
            os.close(write_fd); stream.close()


if __name__ == '__main__':
    unittest.main()
