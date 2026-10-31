"""Native Windows parent for the reviewed auth controller. Imports perform no I/O.

--public-probe uses only public child processes/read-only native commands.
--execute requires fresh independent owner inputs; it is never a source test.
"""
from pathlib import Path
from datetime import datetime, timezone
import argparse
import base64
import hashlib
import importlib.util
import json
import os
import queue
import re
import stat
import subprocess
import sys
import threading
import time

DRIVER = 'native-windows-parent-v1'
PROFILE = 'week1-auth-20261031-smtp1'
ROOT = '/home/anas/.local/share/nextera-judge/' + PROFILE + '/run-001'
PROJECT = '01coding-' + PROFILE
WINDOWS_PYTHON = r'C:\Python315\python.exe'
WSL = r'C:\Windows\System32\wsl.exe'
POWERSHELL = r'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
DOCKER = r'C:\Program Files\Docker\Docker\resources\bin\docker.exe'
ENDPOINT = 'npipe:////./pipe/docker_engine'
GUARD = r'C:\Users\lap\Documents\Codex\2026-10-24\task\verification\host-coordinator-smtp-source-20261031\week1-auth-host-guard.ps1'
MAX_FRAME = 65536
HASH = re.compile(r'^[a-f0-9]{64}$')
BINDING_KEYS = {'driver', 'session', 'scopeSha256', 'sourceLockSha256', 'reviewedHead', 'profile', 'root', 'project'}
UNRELATED_PATHS = frozenset({'apps/web/public/ASSETS.md', 'apps/web/components/learning/home-next-action.module.css',
                             'apps/web/public/piscine/official-logo.svg', 'docs/RELEASE_CANDIDATE_001_REPORT.md'})


class DriverError(ValueError):
    pass


def digest(data):
    return hashlib.sha256(data).hexdigest()


def exact(value, keys):
    if not isinstance(value, dict) or set(value) != set(keys):
        raise DriverError('Unexpected public protocol fields')
    return value


def validate_changed_paths(paths):
    if not isinstance(paths, list) or any(type(name) is not str or name not in UNRELATED_PATHS for name in paths):
        raise DriverError('Unreviewed tracked or untracked source change')


def binding(spec, session):
    value = {'driver': spec['hostGuardDriver'], 'session': session,
             'scopeSha256': spec['scopeSha256'], 'sourceLockSha256': spec['sourceLockSha256'],
             'reviewedHead': spec['reviewedHead'], 'profile': spec['target']['profile'],
             'root': spec['target']['root'], 'project': spec['target']['project']}
    exact(value, BINDING_KEYS)
    if (value['driver'] != DRIVER or value['profile'] != PROFILE or value['root'] != ROOT or
            value['project'] != PROJECT or not all(isinstance(value[k], str) and HASH.fullmatch(value[k])
            for k in ['session', 'scopeSha256', 'sourceLockSha256']) or
            not re.fullmatch(r'[a-f0-9]{40}', value['reviewedHead'])):
        raise DriverError('Driver binding rejected')
    return value


def frame(bound, sequence, operation, payload, status=None):
    result = {'version': 1, 'binding': bound, 'sequence': sequence, 'operation': operation,
              'payload' if status is None else 'result': payload}
    if status is not None:
        result['status'] = status
    return result


def encode(value):
    def public(item):
        if isinstance(item, str) and '\x00' in item:
            raise DriverError('NUL public field')
        if isinstance(item, dict):
            for key, child in item.items():
                if not isinstance(key, str):
                    raise DriverError('String public keys required')
                public(key); public(child)
        elif isinstance(item, list):
            for child in item:
                public(child)
    public(value)
    data = json.dumps(value, ensure_ascii=True, allow_nan=False, separators=(',', ':')).encode() + b'\n'
    if len(data) > MAX_FRAME or b'\x00' in data:
        raise DriverError('Public frame exceeds its bound')
    return data


def decode(data):
    if not data or len(data) > MAX_FRAME or not data.endswith(b'\n'):
        raise DriverError('EOF, partial or oversized public frame')
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise DriverError('Duplicate public fields')
            result[key] = value
        return result
    value = json.loads(data, object_pairs_hook=pairs, parse_constant=lambda _: (_ for _ in ()).throw(DriverError('Non-JSON number')))
    encode(value)  # Validate decoded strings and finite JSON material, without executing it.
    return value


def validate_frame(value, bound, sequence, operation, response=False):
    exact(value, {'version', 'binding', 'sequence', 'operation', 'status', 'result'} if response else
          {'version', 'binding', 'sequence', 'operation', 'payload'})
    if (type(value['version']) is not int or value['version'] != 1 or value['binding'] != bound or type(value['sequence']) is not int or
            value['sequence'] != sequence or value['operation'] != operation or
            (response and value['status'] not in ['ok', 'failed'])):
        raise DriverError('Stale or mismatched public frame')
    return value['result' if response else 'payload']


def pipe_identity(fd):
    value = os.fstat(fd)
    if not stat.S_ISFIFO(value.st_mode):
        raise DriverError('Native parent pipe required')
    return {'device': value.st_dev, 'inode': value.st_ino}


def pipe_closed(fd, identity):
    import select
    try:
        if pipe_identity(fd) != identity:
            return True
        poll = select.poll()
        poll.register(fd, select.POLLHUP | select.POLLERR | select.POLLNVAL)
        return any(mask & (select.POLLHUP | select.POLLERR | select.POLLNVAL) for _, mask in poll.poll(0))
    except (OSError, DriverError):
        return True


class HostClient:
    """Single-use, secret-free pipe RPC. A failed operation is never resent."""
    def __init__(self, bound, read_fd=0, write_fd=1):
        self.bound, self.read_fd, self.write_fd = bound, read_fd, write_fd
        self.identity = pipe_identity(read_fd)
        self.sequence, self.failed, self.buffer = 0, False, b''

    def live(self):
        return not self.failed and not pipe_closed(self.read_fd, self.identity)

    def exchange(self, operation, payload, timeout=30):
        import select
        expected = ['probe', 'arm', 'complete']
        if self.failed or self.sequence >= len(expected) or operation != expected[self.sequence] or not self.live():
            raise DriverError('Closed or out-of-order host operation')
        self.sequence += 1
        deadline = time.monotonic() + timeout
        try:
            data = encode(frame(self.bound, self.sequence, operation, payload))
            blocking = os.get_blocking(self.write_fd)
            os.set_blocking(self.write_fd, False)
            try:
                while data:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0 or not select.select([], [self.write_fd], [], remaining)[1]:
                        raise DriverError('Host dispatch timeout; outcome unknown')
                    data = data[os.write(self.write_fd, data):]
            finally:
                os.set_blocking(self.write_fd, blocking)
            while b'\n' not in self.buffer:
                remaining = deadline - time.monotonic()
                if remaining <= 0 or not select.select([self.read_fd], [], [], remaining)[0]:
                    raise DriverError('Host response timeout; outcome unknown')
                part = os.read(self.read_fd, min(4096, MAX_FRAME + 1 - len(self.buffer)))
                if not part or len(self.buffer) + len(part) > MAX_FRAME:
                    raise DriverError('Host pipe lost or frame oversized')
                self.buffer += part
            line, self.buffer = self.buffer.split(b'\n', 1)
            reply = decode(line + b'\n')
            result = validate_frame(reply, self.bound, self.sequence, operation, response=True)
            if reply['status'] != 'ok':
                raise DriverError('Native host operation failed; no automatic retry')
            return result
        except Exception:
            self.failed = True
            raise


def windows_env():
    return {key: value for key, value in os.environ.items() if key.upper() in
            {'SYSTEMROOT', 'WINDIR', 'USERPROFILE', 'LOCALAPPDATA', 'TEMP', 'TMP', 'PATH', 'COMSPEC'}}


def wsl_args(repo, args):
    return [WSL, '--distribution', 'Ubuntu', '--user', 'anas', '--cd', repo, '--exec', *args]


def native_run(args, timeout=20, data=None):
    if os.name != 'nt':
        raise DriverError('Native Windows execution required; no WSL PE fallback')
    process = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               env=windows_env(), close_fds=True, creationflags=subprocess.CREATE_NO_WINDOW)
    try:
        output, error = process.communicate(data, timeout=timeout)
    except subprocess.TimeoutExpired:
        process.kill()
        process.communicate(timeout=5)
        raise DriverError('Native operation timed out; unknown outcome, no replay')
    if process.returncode or len(output) > 1048576 or len(error) > 1048576:
        raise DriverError('Native operation failed; no raw diagnostics returned')
    return output


def read_line_bounded(stream, timeout, check=None):
    result = queue.Queue(maxsize=1)
    def read():
        try:
            result.put(stream.readline(MAX_FRAME + 1))
        except Exception:
            result.put(b'')
    threading.Thread(target=read, daemon=True).start()
    deadline = time.monotonic() + timeout
    while True:
        if check is not None:
            check()
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise DriverError('Native pipe timeout; no replay')
        try:
            return decode(result.get(timeout=min(.25, remaining)))
        except queue.Empty:
            pass


# Public test processes only: a blocked "controller", its independently inherited
# read FD watcher, and one owned sleeping phase. No auth guard/root/lease is used.
LINUX_PIPE_PROBE = r'''
import hashlib,importlib.util,json,os,signal,subprocess,sys,time
p=sys.argv[1];s=importlib.util.spec_from_file_location('public_pipe_helpers',p);h=importlib.util.module_from_spec(s);s.loader.exec_module(h)
fd=os.dup(0);identity=h.pipe_identity(fd)
phase=subprocess.Popen([sys.executable,'-c','import time;time.sleep(30)'],start_new_session=True)
ticks=open('/proc/'+str(phase.pid)+'/stat').read().rsplit(')',1)[1].split()[19]
watch=r"""import importlib.util,json,os,signal,sys,time
s=importlib.util.spec_from_file_location('probe_helpers',sys.argv[1]);h=importlib.util.module_from_spec(s);s.loader.exec_module(h)
fd,pid,ticks=int(sys.argv[2]),int(sys.argv[3]),sys.argv[4];identity=json.loads(sys.argv[5]);start=time.monotonic()
while not h.pipe_closed(fd,identity):
 if time.monotonic()-start>15:raise SystemExit(3)
 time.sleep(.02)
actual=open('/proc/'+str(pid)+'/stat').read().rsplit(')',1)[1].split()[19]
if actual!=ticks or os.getpgid(pid)!=pid:raise SystemExit(4)
os.killpg(pid,signal.SIGTERM)
print(json.dumps({'event':'eof','ownedPhaseCancelled':True,'pipe':identity}),flush=True)
"""
w=subprocess.Popen([sys.executable,'-u','-c',watch,p,str(fd),str(phase.pid),ticks,json.dumps(identity)],pass_fds=(fd,))
print(json.dumps({'event':'ready','pipe':identity,'sourceSha256':hashlib.sha256(open(p,'rb').read()).hexdigest(),'interopRegistered':os.path.exists('/proc/sys/fs/binfmt_misc/WSLInterop')}),flush=True)
try:
 phase.wait(timeout=20);w.wait(timeout=3)
 if phase.returncode>=0 or w.returncode:raise SystemExit(5)
 print(json.dumps({'event':'complete','phaseExited':phase.poll() is not None,'watcherExited':w.poll() is not None}),flush=True)
finally:
 if phase.poll() is None:os.killpg(phase.pid,signal.SIGKILL);phase.wait()
 if w.poll() is None:w.kill();w.wait()
'''


def public_pipe_owner(repo):
    if os.name != 'nt':
        raise DriverError('Native Windows parent required')
    process = subprocess.Popen(wsl_args(repo, ['/usr/bin/python3', '-u', '-c', LINUX_PIPE_PROBE,
                               repo + '/scripts/week1-auth-host-coordinator.py']), stdin=subprocess.PIPE,
                               stdout=None, stderr=subprocess.DEVNULL, close_fds=True,
                               env=windows_env(), creationflags=subprocess.CREATE_NO_WINDOW)
    try:
        process.wait(timeout=25)
    finally:
        process.stdin.close()
        if process.poll() is None:
            process.kill(); process.wait(timeout=5)


def public_probe(repo):
    if os.name != 'nt' or os.path.normcase(sys.executable) != os.path.normcase(WINDOWS_PYTHON):
        raise DriverError('Installed fixed native Python required')
    script = "@{version=$PSVersionTable.PSVersion.ToString();policy=(Get-ExecutionPolicy);dockerSha=(Get-FileHash -LiteralPath '" + DOCKER + "' -Algorithm SHA256).Hash.ToLowerInvariant()} | ConvertTo-Json -Compress"
    powershell = json.loads(native_run([POWERSHELL, '-NoProfile', '-NonInteractive', '-Command', script]))
    engine = native_run([DOCKER, '--host', ENDPOINT, 'info', '--format', '{{.ID}}']).decode().strip()
    linux_engine = native_run(wsl_args(repo, ['docker', '--host', 'unix:///var/run/docker.sock', 'info', '--format', '{{.ID}}'])).decode().strip()
    if not engine or engine != linux_engine or not HASH.fullmatch(powershell['dockerSha']):
        raise DriverError('Native/WSL Docker engine identity mismatch')
    owner = subprocess.Popen([WINDOWS_PYTHON, str(Path(__file__).resolve()), '--public-pipe-owner', '--repo', repo],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=windows_env(), close_fds=True,
                creationflags=subprocess.CREATE_NO_WINDOW)
    try:
        ready = read_line_bounded(owner.stdout, 10)
        if ready.get('event') != 'ready' or ready.get('sourceSha256') != digest(Path(__file__).read_bytes()):
            raise DriverError('Actual WSL pipe probe did not start')
        owner.terminate(); owner.wait(timeout=5)  # Exact process handle created above; no enumeration/foreign kill.
        eof = read_line_bounded(owner.stdout, 8)
        if eof != {'event': 'eof', 'ownedPhaseCancelled': True, 'pipe': ready['pipe']}:
            raise DriverError('Actual native-parent loss/phase cancellation unproved')
        complete = read_line_bounded(owner.stdout, 8)
        if complete != {'event':'complete','phaseExited':True,'watcherExited':True}:
            raise DriverError('Public probe phase/watcher exit unproved')
    finally:
        if owner.poll() is None:
            owner.kill(); owner.wait(timeout=5)
        owner.stdout.close(); owner.stderr.close()
    return {'driver': DRIVER, 'windowsPython': sys.executable, 'powershell': powershell,
            'engineId': engine, 'wslEngineId': linux_engine, 'actualParentLossCancelsOwnedPhase': True,
            'coordinatorSourceSha256': ready['sourceSha256'],
            'wslInteropRequired': False, 'wslInteropRegistered': ready['interopRegistered'],
            'liveRemoteSignedProbeExecuted': False, 'runtimeCreated': False}


def host_command(mode, policy, *arguments):
    if policy != 'process-RemoteSigned' or mode not in ['Probe', 'Install', 'Complete']:
        raise DriverError('Exact approved process-only policy required')
    return [POWERSHELL, '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned',
            '-File', GUARD, '-' + mode, *arguments]


def validate_manifest(manifest, bound, probe):
    exact(manifest, {'version','profile','root','project','scopeSha256','sourceLockSha256','reviewedHead',
          'engineId','dockerCliSha256','services','startedUtc','deadlineUtc','cleanupAtUtc','baselineContainerIds'})
    for key in ['profile','root','project','scopeSha256','sourceLockSha256','reviewedHead']:
        if manifest[key] != bound[key]:
            raise DriverError('Host manifest differs from original binding')
    stamps = [datetime.fromisoformat(manifest[key]) for key in ['startedUtc','deadlineUtc','cleanupAtUtc']]
    if (manifest['version'] != 1 or (stamps[1]-stamps[0]).total_seconds() != 3600 or
            (stamps[1]-stamps[2]).total_seconds() != 180 or datetime.now(timezone.utc) >= stamps[2] or
            manifest['engineId'] != probe['engineId'] or manifest['dockerCliSha256'] != probe['dockerSha']):
        raise DriverError('Original host lifetime/engine changed')


def browser_helpers():
    source = Path(__file__).with_name('week1-auth-browser-host.py')
    setup = importlib.util.spec_from_file_location('native_private_browser_host', source)
    helper = importlib.util.module_from_spec(setup)
    setup.loader.exec_module(helper)
    return helper


class NativeSession:
    def __init__(self, bound, spec, guard_sha, run=native_run, verify_sources=None,
                 browser_factory=None, browser_config=None):
        self.bound, self.spec, self.guard_sha, self.run = bound, spec, guard_sha, run
        coordinator_sha = digest(Path(__file__).read_bytes())
        self.verify_sources = verify_sources or (lambda: digest(Path(GUARD).read_bytes()) == guard_sha and
                                                digest(Path(__file__).read_bytes()) == coordinator_sha)
        self.sequence, self.failed, self.probe, self.guard, self.arm_attempted = 0, False, None, None, False
        self.deadline, self.monotonic_end = None, None
        self.browser, self.browser_config = None, browser_config
        self.browser_factory = browser_factory or (lambda config: browser_helpers().start(config))

    def check_browser(self):
        if self.browser is not None:
            self.browser.check()

    def close_browser(self):
        if self.browser is not None:
            self.browser.close()

    def remaining(self, ceiling):
        if self.deadline is None:
            return ceiling
        value = min(ceiling, (self.deadline-datetime.now(timezone.utc)).total_seconds(),
                    self.monotonic_end-time.monotonic())
        if value <= 0:
            raise DriverError('Original native lease deadline reached; no renewal')
        return value

    def handle(self, value):
        operations = ['probe', 'arm', 'complete']
        if self.failed or self.sequence >= len(operations):
            raise DriverError('Closed native session')
        operation = operations[self.sequence]
        payload = validate_frame(value, self.bound, self.sequence + 1, operation)
        self.sequence += 1  # Consume BEFORE dispatch: unknown outcome cannot be retried.
        try:
            if not self.verify_sources():
                raise DriverError('Native source changed before dispatch')
            if operation == 'probe':
                exact(payload, {'linuxEngineId','guardSha256','coordinatorSha256'})
                if payload['guardSha256'] != self.guard_sha or payload['coordinatorSha256'] != digest(Path(__file__).read_bytes()):
                    raise DriverError('Native source copy differs')
                result = json.loads(self.run(host_command('Probe', self.spec['hostGuardExecutionPolicy'],
                                  '-ProbeNonce', self.bound['session']), timeout=20))
                exact(result, {'ready','nonce','engineId','dockerSha','childPid','childStartedTicks','childExited','guardSha256'})
                if (result['ready'] is not True or result['nonce'] != self.bound['session'] or
                        result['engineId'] != payload['linuxEngineId'] or result['guardSha256'] != self.guard_sha or
                        result['childExited'] is not True or type(result['childPid']) is not int or result['childPid'] <= 0 or
                        not HASH.fullmatch(result['dockerSha']) or not str(result['childStartedTicks']).isdigit() or
                        int(result['childStartedTicks']) <= 0):
                    raise DriverError('Actual native guard launch probe rejected')
                self.probe = result
            elif operation == 'arm':
                exact(payload, {'manifest','manifestSha256'})
                raw = json.dumps(payload['manifest'], separators=(',', ':')).encode()
                if digest(raw) != payload['manifestSha256']:
                    raise DriverError('Changed arm manifest')
                validate_manifest(payload['manifest'], self.bound, self.probe)
                if payload['manifest']['services'] != self.spec['images']:
                    raise DriverError('Changed service images')
                self.deadline = datetime.fromisoformat(payload['manifest']['deadlineUtc'])
                self.monotonic_end = time.monotonic() + max(0, (self.deadline-datetime.now(timezone.utc)).total_seconds())
                self.arm_attempted = True
                result = json.loads(self.run(host_command('Install', self.spec['hostGuardExecutionPolicy'],
                            '-ManifestJsonBase64', base64.b64encode(raw).decode()), timeout=self.remaining(30)))
                required = {'profile','scopeSha256','engineId','pid','startedTicks','cache','manifestSha256','guardSourceSha256','ready'}
                exact(result, required)
                if (result['ready'] is not True or result['scopeSha256'] != self.bound['scopeSha256'] or
                        result['engineId'] != self.probe['engineId'] or result['guardSourceSha256'] != self.guard_sha or
                        result['profile'] != PROFILE or type(result['pid']) is not int or result['pid'] <= 0 or
                        not str(result['startedTicks']).isdigit() or int(result['startedTicks']) <= 0 or
                        not HASH.fullmatch(result['manifestSha256'])):
                    raise DriverError('Native installer acknowledgement rejected')
                self.guard = result
                if self.browser_config is None:
                    raise DriverError('Source-bound native browser configuration required')
                manifest = payload['manifest']
                def millis(key):
                    return round(datetime.fromisoformat(manifest[key]).timestamp() * 1000)
                browser_config = {**self.browser_config, 'binding': self.bound, 'cache': result['cache'],
                    'manifestSha256': result['manifestSha256'], 'started': millis('startedUtc'),
                    'deadline': millis('deadlineUtc'), 'cleanupAt': millis('cleanupAtUtc')}
                # Worker begins with stdin GO; factory assigns exact retained HANDLE to
                # its kill-on-close Job before releasing GO. It waits for the WSL marker.
                self.browser = self.browser_factory(browser_config)
                self.browser.check()
            else:
                exact(payload, {'linuxCleanupVerified'})
                if payload['linuxCleanupVerified'] is not True or not self.guard:
                    raise DriverError('Native fail-safe retained; Linux cleanup unverified')
                if self.browser is None:
                    raise DriverError('Native browser worker completion unavailable')
                self.browser.finish(self.remaining(10))
                result = json.loads(self.run(host_command('Complete', self.spec['hostGuardExecutionPolicy'],
                            '-ManifestPath', str(Path(self.guard['cache']) / 'manifest.json'),
                            '-ManifestSha256', self.guard['manifestSha256'], '-GuardPid', str(self.guard['pid']),
                            '-GuardStartedTicks', str(self.guard['startedTicks']), '-GuardSourceSha256', self.guard_sha), timeout=self.remaining(15)))
                exact(result, {'guardStopped','pid','startedTicks','scopeSha256','manifestSha256','guardSourceSha256'})
                if (result['guardStopped'] is not True or any(result[key] != self.guard[key] for key in
                    ['pid','startedTicks','scopeSha256','manifestSha256','guardSourceSha256'])):
                    raise DriverError('Exact native guard closure unproved')
            return frame(self.bound, self.sequence, operation, result, status='ok')
        except Exception:
            self.failed = True
            self.close_browser()
            raise


PUBLIC_PACKET_READER = r"""from pathlib import Path
import hashlib,json,subprocess,sys
repo,spec,lock=map(Path,sys.argv[1:]);raw=lock.read_bytes();data=json.loads(raw)
print(json.dumps({'spec':json.loads(spec.read_bytes()),'lock':data,'lockSha':hashlib.sha256(raw).hexdigest(),
'head':subprocess.check_output(['git','-C',str(repo),'rev-parse','HEAD'],text=True).strip(),
'changedPaths':sorted(set(name.decode() for raw in [subprocess.check_output(['git','-C',str(repo),'diff','--no-renames','--name-only','-z','HEAD']),subprocess.check_output(['git','-C',str(repo),'ls-files','--others','--exclude-standard','-z'])] for name in raw.split(b'\0') if name)),
'sourceHashes':{name:hashlib.sha256((repo/name).read_bytes()).hexdigest() for name in data['sources']}}))
"""


def execute(args):
    if os.name != 'nt' or os.path.normcase(sys.executable) != os.path.normcase(WINDOWS_PYTHON):
        raise DriverError('Fixed native Windows Python parent required')
    if not all(getattr(args, name) for name in ['repo','template','spec','source_lock','source_lock_sha256',
        'approval_receipt','owner_message_id','owner_approved_at','scope_sha256','browser_context']):
        raise DriverError('Explicit independent owner/source inputs required')
    approved = datetime.fromisoformat(args.owner_approved_at.replace('Z', '+00:00'))
    if (approved.utcoffset().total_seconds() != 0 or not 0 <= (datetime.now(timezone.utc)-approved).total_seconds() <= 600 or
            not re.fullmatch(r'Sentinel_[a-f0-9]{32}', args.owner_message_id)):
        raise DriverError('Original authentic owner admission window required')
    # Read public source metadata only. Authentic protected owner INPUT is read
    # and matched by the source-bound WSL controller before it requests a probe.
    public = json.loads(native_run(wsl_args(args.repo, ['/usr/bin/python3','-c',PUBLIC_PACKET_READER,
                                    args.repo,args.spec,args.source_lock])))
    spec, lock = public['spec'], public['lock']
    validate_changed_paths(public['changedPaths'])
    if (public['lockSha'] != args.source_lock_sha256 or spec['sourceLockSha256'] != args.source_lock_sha256 or
            spec['scopeSha256'] != args.scope_sha256 or public['head'] != spec['reviewedHead'] or
            public['sourceHashes'] != lock['sources'] or digest(Path(__file__).read_bytes()) != lock['sources'].get('scripts/week1-auth-host-coordinator.py') or
            digest(Path(GUARD).read_bytes()) != lock['sources'].get('scripts/week1-auth-host-guard.ps1')):
        raise DriverError('Native coordinator/source packet mismatch')
    browser_source = Path(__file__).with_name('week1-auth-browser-host.py')
    consumer_source = Path(__file__).with_name('week1-auth-browser-consumer.mjs')
    if (digest(browser_source.read_bytes()) != lock['sources'].get('scripts/week1-auth-browser-host.py') or
            digest(consumer_source.read_bytes()) != lock['sources'].get('scripts/week1-auth-browser-consumer.mjs')):
        raise DriverError('Native browser source copy differs from reviewed packet')
    actual_probe = public_probe(args.repo)  # Real supported cross-platform/engine/EOF path, before any reservation.
    session_id = digest((str(os.getpid()) + ':' + str(time.monotonic_ns()) + ':' + args.scope_sha256).encode())
    bound = binding(spec, session_id)
    browser_config = {'repo': args.repo,
        'helperSha256': lock['sources']['scripts/week1-auth-rehearsal.py'],
        'brokerSha256': lock['sources']['scripts/week1-auth-live-broker.mjs'],
        'consumerSha256': lock['sources']['scripts/week1-auth-browser-consumer.mjs'],
        'hostSha256': lock['sources']['scripts/week1-auth-browser-host.py']}
    session = NativeSession(bound, spec, lock['sources']['scripts/week1-auth-host-guard.ps1'],
        browser_config=browser_config,
        verify_sources=lambda: all(digest(path.read_bytes()) == wanted for path, wanted in [
            (Path(GUARD), lock['sources']['scripts/week1-auth-host-guard.ps1']),
            (Path(__file__), lock['sources']['scripts/week1-auth-host-coordinator.py']),
            (browser_source, browser_config['hostSha256']), (consumer_source, browser_config['consumerSha256'])]))
    command = wsl_args(args.repo, ['/usr/bin/python3','-B',args.repo+'/scripts/week1-auth-rehearsal.py','--execute'])
    for name in ['repo','template','spec','source_lock','source_lock_sha256','approval_receipt','owner_message_id','owner_approved_at','scope_sha256','browser_context']:
        command += ['--'+name.replace('_','-'), getattr(args,name)]
    command += ['--host-driver-session', session_id]
    child = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                close_fds=True, env=windows_env(), creationflags=subprocess.CREATE_NO_WINDOW)
    try:
        for _ in range(3):
            request = read_line_bounded(child.stdout, session.remaining(3600) if session.sequence == 2 else 60,
                check=session.check_browser)
            reply = session.handle(request)
            child.stdin.write(encode(reply)); child.stdin.flush()
        child.stdin.close()
        child.wait(timeout=session.remaining(10))
        if child.returncode:
            raise DriverError('WSL controller final exit unverified')
        return {'status':'native_parent_completed','runtimeReady':False,'cleanupVerified':True,
                'nativeGuardStopped':True,'guardPid':session.guard['pid'],'guardStartedTicks':session.guard['startedTicks']}
    finally:
        # EOF wakes the independently inherited Linux watcher even if the
        # controller is blocked in an owned phase. Do not kill wsl.exe first.
        try:
            session.close_browser()
        finally:
            if not child.stdin.closed:
                child.stdin.close()
        if child.poll() is None:
            try:
                child.wait(timeout=session.remaining(15))
            except (subprocess.TimeoutExpired, DriverError):
                pass  # Guard fail-safe retains original cutoff; never claim process closure here.
        child.stdout.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--public-probe', action='store_true')
    parser.add_argument('--public-pipe-owner', action='store_true')
    for name in ['repo','template','spec','source-lock','source-lock-sha256','approval-receipt',
                 'owner-message-id','owner-approved-at','scope-sha256','browser-context']:
        parser.add_argument('--'+name)
    args = parser.parse_args()
    if args.public_pipe_owner:
        public_pipe_owner(args.repo)
    elif args.public_probe:
        print(json.dumps(public_probe(args.repo)))
    elif args.execute:
        print(json.dumps(execute(args)))
    else:
        print(json.dumps({'driver':DRIVER,'root':ROOT,'status':'source_only_not_authorized','runtimeReady':False}))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('NATIVE_HOST_COORDINATOR_FAILED; no automatic retry; native guard closure may be unverified', file=sys.stderr)
        sys.exit(1)
