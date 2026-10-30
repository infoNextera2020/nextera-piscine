"""Fresh Week 1 broker/controller source; default CLI prints a non-secret proposal.

--execute is a FUTURE explicit owner-approved action, never called by unit tests.
No old profile is widened. Injected lifecycle tests do not prove native readiness.
"""
from pathlib import Path
from datetime import datetime, timezone
import argparse
import base64
import fcntl
import hashlib
import importlib.util
import io
import json
import os
import re
import signal
import socket
import stat
import subprocess
import sys
import tarfile
import time

PROFILE = 'week1-auth-20261030-invitation1'
ROOT = '/home/anas/.local/share/nextera-judge/' + PROFILE + '/run-001'
PROJECT = '01coding-' + PROFILE
DATABASE = 'foundation_test_week1_auth_20261030_invitation1'
SERVICES = ('db', 'auth', 'rest', 'storage', 'imgproxy', 'meta', 'studio', 'api-gw')
PORTS = (56531, 56532, 3151)
CLOSED_MESSAGES = frozenset({
    'Sentinel_7b5ec1bcc1cc819187d19f16ccc96f4a',
    'Sentinel_754d4f4bf350819194caab16f4119f8b',
    'Sentinel_86aebfe913e48191b51fc427a33efe78',
    'Sentinel_6c15d89054c08191b4923a8313c5552b',
})
_OWNER_BINDINGS = {}


class ScopeError(ValueError):
    pass


def proposal():
    return {'profile': PROFILE, 'root': ROOT, 'project': PROJECT, 'database': DATABASE,
            'ports': list(PORTS), 'ownerApprovalStartSeconds': 600, 'maximumSeconds': 3600,
            'cleanupReserveSeconds': 180, 'status': 'source_only_not_authorized',
            'runtimeReady': False, 'learnersCreatedOnlyByInvitationActivation': True,
            'retainedDataAndEvidence': True, 'optional0021And0022Included': False}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def owner_microseconds(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)', value):
        raise ScopeError('Exact authentic UTC owner time required; no current-time default.')
    stamp = datetime.fromisoformat(value.replace('Z', '+00:00'))
    delta = stamp - datetime(1970, 1, 1, tzinfo=timezone.utc)
    return delta.days * 86400000000 + delta.seconds * 1000000 + delta.microseconds


def scope_sha256(spec):
    body = {k: v for k, v in spec.items() if k not in ['scopeSha256', 'status', 'runtimeReady']}
    return sha(json.dumps(body, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode())


def admit(spec, owner, now_ms):
    if spec.get('scopeSha256') != scope_sha256(spec):
        raise ScopeError('Exact approved scope content changed.')
    if (not re.fullmatch(r'Sentinel_[a-f0-9]{32}', owner.get('messageId', '')) or
            owner['messageId'] in CLOSED_MESSAGES or owner.get('scopeSha256') != spec.get('scopeSha256')):
        raise ScopeError('Fresh independent authentic owner ID/scope required.')
    approved = owner_microseconds(owner.get('approvedAt'))
    bound = (owner['approvedAt'], owner['scopeSha256'])
    if _OWNER_BINDINGS.setdefault(owner['messageId'], bound) != bound:
        raise ScopeError('Owner message time/scope cannot be reassigned.')
    if type(now_ms) is not int or not 0 <= now_ms * 1000 - approved <= 600000000:
        raise ScopeError('Owner admission expired or future; receipt time cannot renew it.')
    if spec.get('target', {}).get('root') != ROOT or spec['target'].get('database') != DATABASE or spec['target'].get('project') != PROJECT:
        raise ScopeError('Exact new target required.')
    if spec.get('bounds') != {'ownerApprovalStartSeconds': 600, 'maximumSeconds': 3600, 'cleanupReserveSeconds': 180}:
        raise ScopeError('Unrenewable exact bounds required.')


def guard_should_stop(control, now_ms, mono_ms, read_process):
    try:
        parent = read_process(control['parentPid'])
        alive = parent['ticks'] == control['parentTicks'] and parent['uid'] == control['uid']
    except (OSError, KeyError):
        alive = False
    return (not alive or now_ms >= control['cleanupAt'] or
            mono_ms >= control['monotonicDeadline'] - 180000)


def exercise_injected(io_port, spec, owner, now_ms, mono_ms):
    """Fully injected fake contract; never constructs or calls LiveBroker.execute/start."""
    admit(spec, owner, now_ms())
    io_port.preflight(spec)
    admit(spec, owner, now_ms())
    started = now_ms()
    control = {'started': started, 'deadline': started + 3600000,
               'cleanupAt': started + 3420000, 'monotonicStarted': mono_ms(),
               'ownerMessageId': owner['messageId'], 'ownerApprovedAt': owner['approvedAt']}
    control['monotonicDeadline'] = control['monotonicStarted'] + 3600000
    reservation = io_port.reserve(spec, control)
    passed = cleanup = False
    try:
        io_port.arm_guard(reservation, control)
        for phase in ['stage', 'stack', 'migrations', 'bootstrap', 'web', 'invitations', 'assert_http']:
            if now_ms() >= control['cleanupAt'] or mono_ms() >= control['monotonicDeadline'] - 180000:
                raise ScopeError('Original cutoff; no renewal.')
            io_port.check_parent()
            io_port.journal({'phase': phase, 'state': 'intent'})
            io_port.phase(phase, reservation)
        passed = now_ms() < control['cleanupAt']
    except Exception:
        passed = False
    finally:
        try:
            result = io_port.cleanup(reservation)
            cleanup = all(result.get(k) is True for k in ['providerRevoked', 'appDisabled', 'sqlDisabled', 'stopped', 'retained'])
        except Exception:
            cleanup = False
    return {'status': 'injected_lifecycle_only', 'assertionsPassed': passed,
            'cleanupVerified': cleanup, 'runtimeReady': False, 'deadline': control['deadline']}


def private_read(file):
    """Read/fstat the same NOFOLLOW descriptor, bounded before allocation."""
    fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        before = os.fstat(fd)
        if (not stat.S_ISREG(before.st_mode) or before.st_uid != os.getuid() or
                stat.S_IMODE(before.st_mode) != 0o600 or not 0 < before.st_size <= 1048576):
            raise ScopeError('Protected file required.')
        data = b''
        while len(data) <= before.st_size:
            part = os.read(fd, min(65536, before.st_size + 1 - len(data)))
            if not part:
                break
            data += part
        after = os.fstat(fd)
        if len(data) != before.st_size or (before.st_ino, before.st_dev, before.st_size, before.st_mtime_ns) != (after.st_ino, after.st_dev, after.st_size, after.st_mtime_ns):
            raise ScopeError('Protected file changed.')
        return data
    finally:
        os.close(fd)


def private_write(file, value, exclusive=False):
    file = Path(file)
    temporary = file if exclusive else file.with_name(file.name + '.next')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        data = (json.dumps(value, separators=(',', ':'), ensure_ascii=False) + '\n').encode()
        with os.fdopen(fd, 'wb', closefd=False) as stream:
            stream.write(data)
            stream.flush()
            os.fsync(fd)
    finally:
        os.close(fd)
    if not exclusive:
        os.replace(temporary, file)
    directory = os.open(file.parent, os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def process_identity(pid):
    proc = Path('/proc', str(pid))
    return {'pid': pid, 'uid': proc.stat().st_uid,
            'ticks': (proc / 'stat').read_text().rsplit(')', 1)[1].split()[19]}


SOURCE_SPEC_VALIDATE_JS = """import fs from 'node:fs';
import {prepareWeek1AuthBroker} from './scripts/week1-auth-live-broker.mjs';
const p=prepareWeek1AuthBroker(JSON.parse(fs.readFileSync(0,'utf8')));
process.stdout.write(JSON.stringify({status:'validated_not_authorized',scopeSha256:p.scopeSha256,runtimeReady:false}));
"""

HOST_GUARD_LOCAL_SOURCE = r'C:\Users\lap\Documents\Codex\2026-10-24\task\verification\host-guard-unit-20261030\week1-auth-host-guard.ps1'
HOST_GUARD_MOUNTED_SOURCE = '/mnt/c/Users/lap/Documents/Codex/2026-10-24/task/verification/host-guard-unit-20261030/week1-auth-host-guard.ps1'

def host_guard_install_command(policy, manifest_base64):
    # Source preparation only. A future exact live approval must explicitly cover
    # this installer and its inherited child-process policy, not just fake tests.
    if policy != 'process-RemoteSigned':
        raise ScopeError('Explicit scope-bound process-only host policy required.')
    return ['/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',
            '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned',
            '-File', HOST_GUARD_LOCAL_SOURCE, '-Install', '-ManifestJsonBase64', manifest_base64]

class LiveBroker:
    """Concrete future launch/shutdown adapter; construction itself is inert.

    No caller may replace ROOT/PROJECT/DATABASE. Source snapshot and frozen
    manifests are retained; existing closed profiles are never adopted.
    """
    def __init__(self, repo, template, spec, lock, owner, browser, command=None, lock_bytes=None,
                 now=lambda: int(time.time() * 1000), monotonic=lambda: time.monotonic_ns() // 1000000):
        self.repo, self.template, self.run = Path(repo).resolve(), Path(template).resolve(), Path(ROOT)
        self.spec, self.lock, self.owner, self.browser = spec, lock, owner, browser
        self.lock_bytes = lock_bytes
        self.now, self.monotonic, self.command_override = now, monotonic, command
        self.node = str(self.repo / '.tools/node-v24.19.0-linux-x64/bin/node')
        self.env = {'PATH': str(Path(self.node).parent) + ':/usr/bin:/bin', 'HOME': str(Path.home()),
                    'LANG': 'C.UTF-8', 'NEXT_TELEMETRY_DISABLED': '1', 'DOCKER_CONFIG': ROOT + '/docker-client'}
        self.module = None

    def helpers(self):
        if self.module is None:
            # Reuse ONLY target-agnostic bounded process/build helpers. Never call
            # the legacy LiveAdapter or change its closed profile registry.
            file = Path(__file__).with_name('checkpoint-auth-live-adapter.py')
            spec = importlib.util.spec_from_file_location('week1_proven_helpers', file)
            self.module = importlib.util.module_from_spec(spec)
            sys.modules[spec.name] = self.module
            spec.loader.exec_module(self.module)
        return self.module

    def command(self, args, timeout=30, data=None, cwd=None, env=None):
        if args and args[0] == 'docker':
            args = ['docker', '--host', 'unix:///var/run/docker.sock', *args[1:]]
        if self.command_override:
            return self.command_override([str(x) for x in args], timeout=timeout, data=data, cwd=cwd, env=env or self.env)
        return self.helpers().Commands().run([str(x) for x in args], env=env or self.env,
                                             cwd=cwd or self.repo, input=data, timeout=timeout)

    def compose(self, *args):
        return ['docker', 'compose', '--project-name', PROJECT, '--project-directory', ROOT + '/stack',
                '--env-file', ROOT + '/stack/.env', '-f', ROOT + '/stack/docker-compose.yml', *args]

    def read(self):
        root = self.run.lstat()
        if self.run.is_symlink() or root.st_uid != os.getuid() or stat.S_IMODE(root.st_mode) != 0o700:
            raise ScopeError('Wrong retained root.')
        c = json.loads(private_read(self.run / 'broker-control.private.json'))
        if c.get('profile') != PROFILE or c.get('scopeSha256') != self.spec['scopeSha256'] or c.get('database') != DATABASE or c.get('project') != PROJECT:
            raise ScopeError('Wrong immutable lease target.')
        if c['deadline'] - c['started'] != 3600000 or c['cleanupAt'] != c['deadline'] - 180000:
            raise ScopeError('Changed immutable deadline.')
        return c

    def preflight(self):
        admit(self.spec, self.owner, self.now())
        if self.spec.get('hostGuardExecutionPolicy') != 'process-RemoteSigned':
            raise ScopeError('Live process-only host guard policy not scope-bound.')
        host_source = Path(HOST_GUARD_MOUNTED_SOURCE)
        if (host_source.is_symlink() or not host_source.is_file() or
                sha(host_source.read_bytes()) != self.lock['sources'].get('scripts/week1-auth-host-guard.ps1')):
            raise ScopeError('Reviewed local Windows guard source mismatch.')
        if self.run.exists() or any(p.is_symlink() for p in [self.run, *self.run.parents]):
            raise ScopeError('Fresh unused root required; never adopt uncertain state.')
        if (self.browser.get('origin') != 'http://127.0.0.1:3151' or self.browser.get('transport') != 'Chrome extension' or
                self.browser.get('deniedRouteRetried') is not False or not 0 <= self.now() - self.browser.get('observedAt', 0) <= 300000):
            raise ScopeError('Fresh permitted browser transport/context proof required.')
        if not isinstance(self.lock_bytes, bytes) or sha(self.lock_bytes) != self.spec['sourceLockSha256']:
            raise ScopeError('Exact frozen source lock bytes required.')
        if self.command(['git', 'rev-parse', 'HEAD']).decode().strip() != self.spec['reviewedHead']:
            raise ScopeError('Reviewed HEAD changed.')
        allow = {'apps/web/public/ASSETS.md', 'apps/web/components/learning/home-next-action.module.css',
                 'apps/web/public/piscine/official-logo.svg', 'docs/RELEASE_CANDIDATE_001_REPORT.md'}
        changed = self.command(['git', 'diff', '--name-only', '-z', 'HEAD']).decode().split('\0')
        if any(v and v not in allow for v in changed):
            raise ScopeError('Commit and independently review source before approval.')
        for name, expected in self.lock['sources'].items():
            p = self.repo / name
            if Path(name).is_absolute() or '..' in Path(name).parts or p.is_symlink() or sha(p.read_bytes()) != expected:
                raise ScopeError('Source lock mismatch.')
        # Validate the FULL public broker policy/mode before reserving any target,
        # starting either guard or minting secrets. Module import performs no I/O.
        validated = json.loads(self.command([self.node, '--input-type=module', '-e', SOURCE_SPEC_VALIDATE_JS],
                                           data=json.dumps(self.spec).encode(), timeout=10))
        if validated != {'status': 'validated_not_authorized', 'scopeSha256': self.spec['scopeSha256'], 'runtimeReady': False}:
            raise ScopeError('Public broker source validation failed.')
        for name, expected in self.lock['templates'].items():
            p = self.template / name
            if p.is_symlink() or not p.resolve().is_relative_to(self.template) or sha(p.read_bytes()) != expected:
                raise ScopeError('Pinned public template mismatch.')
        for image in self.spec['images'].values():
            self.command(['docker', 'image', 'inspect', image])
        if self.command(['docker', 'ps', '-aq', '--filter', 'label=com.docker.compose.project=' + PROJECT]).strip():
            raise ScopeError('Project occupied.')
        if any(v.startswith(PROJECT + '-') for v in self.command(['docker', 'volume', 'ls', '-q']).decode().splitlines()):
            raise ScopeError('Volume occupied.')
        if self.command(['docker', 'network', 'ls', '-q', '--filter', 'label=com.docker.compose.project=' + PROJECT]).strip():
            raise ScopeError('Network occupied.')
        for port in PORTS:
            with socket.socket() as probe:
                probe.settimeout(1)
                if probe.connect_ex(('127.0.0.1', port)) == 0:
                    raise ScopeError('Loopback port occupied.')
        self.helpers().direct_build_plan(self.repo, node=self.node)
        return {'status': 'preflight_only_not_authorized', 'runtimeReady': False}

    def reserve(self):
        admit(self.spec, self.owner, self.now())
        self.run.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.run.mkdir(mode=0o700)
        for name in ['adapter-code', 'docker-client']:
            (self.run / name).mkdir(mode=0o700)
        started, mono = self.now(), self.monotonic()
        control = {'profile': PROFILE, 'project': PROJECT, 'database': DATABASE, 'uid': os.getuid(),
                   'scopeSha256': self.spec['scopeSha256'], 'sourceLockSha256': self.spec['sourceLockSha256'],
                   'ownerMessageId': self.owner['messageId'], 'ownerApprovedAt': self.owner['approvedAt'],
                   'started': started, 'deadline': started + 3600000, 'cleanupAt': started + 3420000,
                   'monotonicStarted': mono, 'monotonicDeadline': mono + 3600000,
                   'parentPid': os.getpid(), 'parentTicks': process_identity(os.getpid())['ticks'],
                   'guardPid': None, 'guardTicks': None, 'repo': str(self.repo), 'template': str(self.template),
                   'spec': self.spec, 'state': 'reserved', 'phases': [],
                   'baselineContainers': self.command(['docker', 'ps', '-aq', '--no-trunc']).decode().splitlines()}
        for name, expected in self.lock['sources'].items():
            if name.startswith('scripts/') and Path(name).suffix in ['.py', '.mjs', '.json', '.ps1']:
                target = self.run / 'adapter-code' / Path(name).name
                data = (self.repo / name).read_bytes()
                if sha(data) != expected or target.exists():
                    raise ScopeError('Broker snapshot changed or basename collision.')
                fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(fd, 'wb') as stream:
                    stream.write(data)
                    stream.flush()
                    os.fsync(stream.fileno())
        lock_file = self.run / 'adapter-code/week1-auth-source-lock.json'
        fd = os.open(lock_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(self.lock_bytes)
            stream.flush()
            os.fsync(stream.fileno())
        private_write(self.run / 'broker-control.private.json', control, True)
        self.env['CHECKPOINT_REHEARSAL_CONTROL'] = ROOT
        return control

    def arm_guard(self):
        log = os.open(self.run / 'guard.private.log', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            child = subprocess.Popen([sys.executable, str(self.run / 'adapter-code/week1-auth-rehearsal.py'), '--watch'],
                                     cwd=self.repo, env=self.env, stdin=subprocess.DEVNULL,
                                     stdout=log, stderr=log, start_new_session=True)
        finally:
            os.close(log)
        c = self.read()
        c.update(guardPid=child.pid, guardTicks=process_identity(child.pid)['ticks'])
        private_write(self.run / 'broker-control.private.json', c)
        for _ in range(100):
            if (self.run / 'guard-ready.private.json').exists():
                return
            if child.poll() is not None:
                break
            time.sleep(.05)
        raise ScopeError('Independent guard did not acknowledge; no secrets may be minted.')

    def arm_host_guard(self):
        """Independent Windows host process survives WSL distro/transport death.

        Cached manifest contains no credentials. A different Windows Docker
        engine, blocked script policy or missing CLI refuses before stack start.
        """
        c = self.check_lease()
        engine = self.command(['docker', 'info', '--format', '{{.ID}}']).decode().strip()
        powershell = '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'
        docker_hash = self.command([powershell, '-NoProfile', '-NonInteractive', '-Command',
                                   "(Get-FileHash -LiteralPath 'C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe' -Algorithm SHA256).Hash.ToLowerInvariant()"])
        def stamp(ms):
            t = datetime.fromtimestamp(ms // 1000, timezone.utc)
            return t.strftime('%Y-%m-%dT%H:%M:%S.') + f'{(ms % 1000) * 10000:07d}+00:00'
        manifest = {'version': 1, 'profile': PROFILE, 'root': ROOT, 'project': PROJECT,
                    'scopeSha256': c['scopeSha256'], 'sourceLockSha256': c['sourceLockSha256'],
                    'reviewedHead': self.spec['reviewedHead'], 'engineId': engine,
                    'dockerCliSha256': docker_hash.decode().strip(), 'services': self.spec['images'],
                    'startedUtc': stamp(c['started']), 'deadlineUtc': stamp(c['deadline']),
                    'cleanupAtUtc': stamp(c['cleanupAt']), 'baselineContainerIds': c['baselineContainers']}
        if sha(Path(HOST_GUARD_MOUNTED_SOURCE).read_bytes()) != self.lock['sources'].get('scripts/week1-auth-host-guard.ps1'):
            raise ScopeError('Reviewed local host guard changed before installer dispatch.')
        receipt = json.loads(self.command(host_guard_install_command(
            self.spec.get('hostGuardExecutionPolicy'), base64.b64encode(json.dumps(manifest).encode()).decode()), timeout=30))
        if receipt.get('ready') is not True or receipt.get('engineId') != engine or receipt.get('scopeSha256') != c['scopeSha256']:
            raise ScopeError('Independent Windows host guard not ready.')
        private_write(self.run / 'host-guard.private.json', receipt, True)

    def journal(self, event):
        c = self.read()
        c['phases'].append(event)
        private_write(self.run / 'broker-control.private.json', c)

    def check_lease(self):
        c = self.read()
        if guard_should_stop(c, self.now(), self.monotonic(), process_identity):
            raise ScopeError('Lease/parent cutoff; no renewal.')
        guard = process_identity(c['guardPid'])
        if guard['ticks'] != c['guardTicks'] or guard['uid'] != c['uid']:
            raise ScopeError('Independent guard identity lost.')
        return c

    def broker(self, phase, cleanup=False):
        c = self.read() if cleanup else self.check_lease()
        remaining = min(c['deadline'] - self.now(), c['monotonicDeadline'] - self.monotonic()) - (30000 if cleanup else 180000)
        if remaining <= 0:
            raise ScopeError('No operation budget remains.')
        return self.command([self.node, self.run / 'adapter-code/week1-auth-live-broker.mjs', '--phase', phase, self.run, self.repo],
                            timeout=min(180, remaining / 1000))

    def snapshot(self):
        data = self.command(['git', 'archive', '--format=tar', self.spec['reviewedHead']])
        dest = self.run / 'app-source'
        dest.mkdir(mode=0o700)
        with tarfile.open(fileobj=io.BytesIO(data)) as archive:
            for member in archive.getmembers():
                if (member.issym() or member.islnk() or not (dest / member.name).resolve().is_relative_to(dest) or
                        (Path(member.name).name.startswith('.env') and not member.name.endswith('.example'))):
                    raise ScopeError('Unsafe/credential-bearing source archive.')
            archive.extractall(dest, filter='data')
        os.chmod(dest, 0o700)
        self.helpers().link_snapshot_dependencies(self.repo, dest)

    def verify_owned_containers(self, permit_partial=False):
        c = self.read()
        ids = self.command(['docker', 'ps', '-aq', '--no-trunc', '--filter', 'label=com.docker.compose.project=' + PROJECT]).decode().splitlines()
        if (not permit_partial and len(ids) != len(SERVICES)) or len(set(ids)) != len(ids):
            raise ScopeError('Unexpected container identities.')
        verified = []
        if ids:
            rows = json.loads(self.command(['docker', 'inspect', *ids]))
            for row in rows:
                labels = row['Config'].get('Labels', {})
                service = labels.get('com.docker.compose.service')
                if (row['Id'] not in ids or row['Id'] in c['baselineContainers'] or
                        labels.get('com.docker.compose.project') != PROJECT or service not in SERVICES or
                        labels.get('com.docker.compose.project.working_dir') != ROOT + '/stack' or
                        labels.get('io.nextera.week1.profile') != PROFILE or
                        labels.get('io.nextera.week1.scope') != c['scopeSha256'] or
                        labels.get('io.nextera.week1.source') != c['sourceLockSha256'] or
                        labels.get('io.nextera.week1.root') != ROOT or
                        row['Config'].get('Image') != self.spec['images'][service]):
                    raise ScopeError('Container ownership not proven.')
                verified.append({'id': row['Id'], 'running': row['State']['Running']})
        private_write(self.run / 'containers.private.json', verified)
        return verified

    def launch_web(self):
        c = self.check_lease()
        credentials = json.loads(private_read(self.run / 'credentials.json'))
        anchor = private_read(self.run / 'startup-anchor.json')
        env = {**self.env, 'NODE_ENV': 'production', 'CI': '1',
               'DATABASE_URL': credentials['connections']['web'],
               'NEXT_PUBLIC_SUPABASE_URL': 'http://127.0.0.1:56531',
               'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY': credentials['anonKey'],
               'CHECKPOINT_DRAFT_STORAGE': 'postgres-v1',
               'NEXTERA_WEEK1_AUTH_PROFILE': PROFILE,
               'NEXTERA_WEEK1_INVITATION_STARTUP_SHA256': sha(anchor)}
        source = self.run / 'app-source'
        self.helpers().validate_build_source_environment(source)
        steps = self.helpers().direct_build_plan(self.repo, source, self.node)
        for step in steps:
            c = self.check_lease()
            remaining = min(c['cleanupAt'] - self.now(), c['monotonicDeadline'] - 180000 - self.monotonic()) / 1000 - 3
            if remaining <= 0:
                raise ScopeError('No build budget.')
            self.command(step['argv'], timeout=min(240, remaining), cwd=step['cwd'], env=env)
        # Gated launch journals PID/ticks before allowing Next to execute.
        log = os.open(self.run / 'web.private.log', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            child = subprocess.Popen([sys.executable, str(self.run / 'adapter-code/week1-auth-rehearsal.py'),
                                      '--supervise-web', '--node', self.node, '--next-cli', steps[-1]['argv'][1]],
                                     cwd=source / 'apps/web', env=env, stdin=subprocess.PIPE,
                                     stdout=log, stderr=log, start_new_session=True)
        finally:
            os.close(log)
        try:
            private_write(self.run / 'web-supervisor.private.json', {**process_identity(child.pid), 'cwd': str(source / 'apps/web')}, True)
            child.stdin.write(b'1')
            child.stdin.flush()
        finally:
            child.stdin.close()
        import urllib.request
        for _ in range(100):
            self.check_lease()
            try:
                with urllib.request.urlopen('http://127.0.0.1:3151/api/health', timeout=1) as response:
                    if response.status == 200:
                        return
            except OSError:
                pass
            if child.poll() is not None:
                break
            time.sleep(.1)
        raise ScopeError('Owned Next process did not become ready.')

    def cleanup(self):
        # This lock serializes controller/guard cleanup; never delete or renew it.
        lock = os.open(self.run / 'cleanup.lock', os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        try:
            fcntl.flock(lock, fcntl.LOCK_EX)
            c = self.read()
            if (self.run / 'cleanup.private.json').exists():
                return json.loads(private_read(self.run / 'cleanup.private.json'))
            errors = []
            access = {'providerRevoked': False, 'appDisabled': False, 'sqlDisabled': False}
            # Cancel a sent/ambiguous work process before inventory/revocation;
            # otherwise it could create another account after the inventory scan.
            phase = self.run / 'phase-process.json'
            if phase.exists():
                record = json.loads(private_read(phase))
                if not record.get('finished'):
                    try:
                        actual = process_identity(record['pid'])
                        if actual['ticks'] != record['ticks'] or actual['uid'] != c['uid'] or os.getpgid(record['pid']) != record['pid']:
                            raise ScopeError('Work process identity mismatch.')
                        os.killpg(record['pid'], signal.SIGTERM)
                        until = min(self.now() + 3000, c['deadline'])
                        while self.now() < until:
                            try:
                                process_identity(record['pid'])
                            except OSError:
                                break
                            time.sleep(.05)
                        else:
                            if process_identity(record['pid'])['ticks'] == record['ticks']:
                                os.killpg(record['pid'], signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    except Exception:
                        errors.append('work_process_stop_unverified')
            self.env.pop('CHECKPOINT_REHEARSAL_CONTROL', None)
            try:
                if (self.run / 'auth-baseline.private.json').exists() and 'work_process_stop_unverified' not in errors:
                    self.broker('cleanup', cleanup=True)
                    access = json.loads(private_read(self.run / 'access-disabled.private.json'))
                elif not any(v.get('phase') == 'bootstrap' for v in c['phases']):
                    access = dict(providerRevoked=True, appDisabled=True, sqlDisabled=True)
            except Exception:
                errors.append('access_cleanup_unverified')
            # Stop only recorded, identity-verified process groups.
            web = self.run / 'web-process.private.json'
            if web.exists():
                record = json.loads(private_read(web))
                try:
                    actual = process_identity(record['pid'])
                    if actual['ticks'] != record['ticks'] or actual['uid'] != c['uid'] or os.getpgid(record['pid']) != record['pid']:
                        raise ScopeError('Web identity mismatch.')
                    os.killpg(record['pid'], signal.SIGTERM)
                    end = min(self.now() + 3000, c['deadline'])
                    while self.now() < end:
                        try:
                            process_identity(record['pid'])
                        except OSError:
                            break
                        time.sleep(.05)
                    else:
                        if process_identity(record['pid'])['ticks'] == record['ticks']:
                            os.killpg(record['pid'], signal.SIGKILL)
                except ProcessLookupError:
                    pass
                except Exception:
                    errors.append('web_stop_unverified')
            try:
                owned = self.verify_owned_containers(permit_partial=True)
                running = [v['id'] for v in owned if v['running']]
                if running:
                    self.command(['docker', 'stop', '--time', '5', *running], timeout=12)
                if self.command(['docker', 'ps', '-q', '--filter', 'label=com.docker.compose.project=' + PROJECT]).strip():
                    raise ScopeError('Containers remain running.')
            except Exception:
                errors.append('container_stop_unverified')
            result = {**access, 'stopped': not errors, 'retained': True, 'noPermanentDeletion': True,
                      'originalDeadline': c['deadline'], 'deadlineMet': self.now() <= c['deadline'], 'errors': errors}
            private_write(self.run / 'cleanup.private.json', result, True)
            return result
        finally:
            os.close(lock)

    def execute(self):
        self.preflight()
        admit(self.spec, self.owner, self.now())
        self.reserve()
        outcome = {'assertionsPassed': False, 'runtimeReady': False}
        try:
            self.arm_guard()
            self.arm_host_guard()
            self.snapshot()
            for phase in ['stage', 'stack', 'baseline', 'migrate', 'bootstrap', 'web', 'invitations', 'assert_http']:
                self.check_lease()
                self.journal({'phase': phase, 'state': 'intent'})
                if phase == 'stack':
                    self.command(self.compose('up', '-d', '--pull', 'never', '--no-build', '--wait', '--wait-timeout', '120', *SERVICES), timeout=150)
                    self.verify_owned_containers()
                elif phase == 'web':
                    self.launch_web()
                else:
                    self.broker(phase)
            # A separate supported-browser receipt and real HTTP assertion adapter
            # remain explicit actions; absence never manufactures E2E readiness.
            outcome['assertionsPassed'] = True
            outcome['status'] = 'native_http_assertions_passed_browser_receipt_pending'
        except Exception:
            outcome['status'] = 'phase_failed_or_unknown_outcome'
        finally:
            outcome['cleanup'] = self.cleanup()
            private_write(self.run / 'outcome.private.json', outcome, True)
        return outcome


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--watch', action='store_true')
    parser.add_argument('--supervise-web', action='store_true')
    parser.add_argument('--node')
    parser.add_argument('--next-cli')
    parser.add_argument('--repo')
    parser.add_argument('--template')
    parser.add_argument('--spec')
    parser.add_argument('--source-lock')
    parser.add_argument('--source-lock-sha256')
    parser.add_argument('--approval-receipt')
    parser.add_argument('--owner-message-id')
    parser.add_argument('--owner-approved-at')
    parser.add_argument('--scope-sha256')
    parser.add_argument('--browser-context')
    args = parser.parse_args()
    if args.supervise_web:
        if sys.stdin.buffer.read(1) != b'1':
            return
        c = json.loads(private_read(Path(ROOT) / 'broker-control.private.json'))
        if (args.node != str(Path(c['repo']) / '.tools/node-v24.19.0-linux-x64/bin/node') or
                not args.next_cli or guard_should_stop(c, int(time.time()*1000), time.monotonic_ns()//1000000, process_identity)):
            raise ScopeError('Original web supervisor lease/command rejected.')
        helper_file = Path(__file__).with_name('checkpoint-auth-live-adapter.py')
        helper_spec = importlib.util.spec_from_file_location('week1_web_supervisor_helpers', helper_file)
        helper = importlib.util.module_from_spec(helper_spec)
        sys.modules[helper_spec.name] = helper
        helper_spec.loader.exec_module(helper)
        child = subprocess.Popen([sys.executable, '-c', helper.GATE, args.node, args.next_cli,
                                  'start', '--hostname', '127.0.0.1', '--port', '3151'],
                                 cwd=Path(ROOT) / 'app-source/apps/web', env=dict(os.environ),
                                 stdin=subprocess.PIPE, start_new_session=True)
        record = process_identity(child.pid)
        stop = [False]
        signal.signal(signal.SIGTERM, lambda *_: stop.__setitem__(0, True))
        signal.signal(signal.SIGINT, lambda *_: stop.__setitem__(0, True))
        try:
            private_write(Path(ROOT) / 'web-process.private.json', {**record, 'cwd': ROOT + '/app-source/apps/web'}, True)
            child.stdin.write(b'1')
            child.stdin.flush()
            child.stdin.close()
            while child.poll() is None and not stop[0]:
                if guard_should_stop(c, int(time.time()*1000), time.monotonic_ns()//1000000, process_identity):
                    break
                time.sleep(.1)
        finally:
            if child.poll() is None:
                actual = process_identity(child.pid)
                if actual['ticks'] != record['ticks'] or os.getpgid(child.pid) != child.pid:
                    raise ScopeError('Web child identity changed; no unrelated signal.')
                os.killpg(child.pid, signal.SIGTERM)
                try:
                    child.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    if process_identity(child.pid)['ticks'] != record['ticks']:
                        raise ScopeError('Web child PID reused.')
                    os.killpg(child.pid, signal.SIGKILL)
                    child.wait(timeout=2)
        return
    if args.watch:
        c = json.loads(private_read(Path(ROOT) / 'broker-control.private.json'))
        lock_bytes = private_read(Path(ROOT) / 'adapter-code/week1-auth-source-lock.json')
        adapter = LiveBroker(c['repo'], c['template'], c['spec'], json.loads(lock_bytes),
                             {'messageId': c['ownerMessageId'], 'approvedAt': c['ownerApprovedAt'], 'scopeSha256': c['scopeSha256']}, {}, lock_bytes=lock_bytes)
        for _ in range(100):
            c = adapter.read()
            if c['guardPid'] == os.getpid() and c['guardTicks'] == process_identity(os.getpid())['ticks']:
                break
            time.sleep(.05)
        else:
            raise ScopeError('Guard not sealed before readiness.')
        private_write(Path(ROOT) / 'guard-ready.private.json', {'pid': os.getpid(), 'ticks': c['guardTicks']}, True)
        while not (Path(ROOT) / 'cleanup.private.json').exists():
            if guard_should_stop(c, adapter.now(), adapter.monotonic(), process_identity):
                adapter.cleanup()
                return
            time.sleep(.25)
        return
    if not args.execute:
        print(json.dumps(proposal(), indent=2))
        return
    if not all(getattr(args, k) for k in ['repo', 'template', 'spec', 'source_lock', 'source_lock_sha256', 'approval_receipt', 'owner_message_id', 'owner_approved_at', 'scope_sha256', 'browser_context']):
        raise ScopeError('Explicit protected source/fresh authentic approval/browser inputs required.')
    spec = json.loads(private_read(args.spec))
    lock_bytes = private_read(args.source_lock)
    if sha(lock_bytes) != args.source_lock_sha256 or spec['sourceLockSha256'] != args.source_lock_sha256:
        raise ScopeError('Independent source hash mismatch.')
    owner = {'messageId': args.owner_message_id, 'approvedAt': args.owner_approved_at, 'scopeSha256': args.scope_sha256}
    receipt = json.loads(private_read(args.approval_receipt))
    if receipt != owner:
        raise ScopeError('Protected receipt cannot replace independent owner ID/time/scope.')
    adapter = LiveBroker(args.repo, args.template, spec, json.loads(lock_bytes), owner,
                         json.loads(private_read(args.browser_context)), lock_bytes=lock_bytes)
    result = adapter.execute()
    print(json.dumps({'status': result['status'], 'runtimeReady': False,
                      'cleanupVerified': all(result['cleanup'].get(k) is True for k in ['providerRevoked', 'appDisabled', 'sqlDisabled', 'stopped', 'retained', 'deadlineMet'])}))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('WEEK1_BROKER_FAILED; protected evidence retained; no automatic retry.', file=sys.stderr)
        sys.exit(1)
