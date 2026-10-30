"""Opt-in disposable adapter test controller. Import/plan never creates resources.

Future run requires a fresh exact approval; tests inject Commands and a separate
temporary fake root. No retained database is adopted and no data is deleted.
"""
from pathlib import Path
import argparse
import datetime as dt
import fcntl
import hashlib
import importlib.util
import json
import math
import os
import pwd
import re
import stat
import sys
import tempfile
import time

REPO = Path('/home/anas/nextera-piscine')
TARGET = Path('/home/anas/.local/share/nextera-judge/checkpoint-migration-adapter-20261029/run-001')
DATABASE = 'foundation_test_checkpoint_migration_adapter_20261029'
ACTOR = 'checkpoint_migration_actor_20261029'
PROBE = 'checkpoint_migration_probe_20261029'
PORT = '55451'
MAX_SECONDS, CLEANUP_EARLY, APPROVAL_SECONDS = 1800, 180, 600
SOURCE_BLOCKERS = ['registered_prerequisite_acl_authority_requires_review']
PERMISSION_ROLES = ['nextera_web', 'nextera_judge_owner', 'nextera_runner',
                    'nextera_judge_maintenance', 'nextera_result_application',
                    'nextera_checkpoint_owner', 'nextera_raid_owner']
SCOPE = {'version': 1, 'database': DATABASE, 'target': str(TARGET), 'socket': 's',
         'socket_identifier': PORT, 'tcp': False, 'actor': ACTOR, 'probe': PROBE,
         'nologin_roles': PERMISSION_ROLES + [ACTOR, PROBE],
         'maximum_seconds': MAX_SECONDS, 'cleanup_early_seconds': CLEANUP_EARLY,
         'approval_start_seconds': APPROVAL_SECONDS,
         'migrations': 'registered0000-0010+draft0011+draft0014',
         'auth_accounts_or_passwords': False, 'retained_data_touched': False,
         'permanent_deletion': False, 'guard_owner': 'anas',
         'actor_createrole': 'prerequisites only, then revoked',
         'guard': 'zero-argument catalog lock; schema USAGE/audit INSERT/guard EXECUTE only',
         'probe_acl': 'temporary USAGE/INSERT/EXECUTE on new guard objects; restore exactly',
         'case_order': 'negatives/forced rollback first; one acknowledged commit last'}


def load_lifecycle(repo):
    spec = importlib.util.spec_from_file_location('migration_adapter_lifecycle', repo / 'scripts/test-checkpoint-context-isolated.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def source_manifest(repo):
    fixed = ['scripts/test-checkpoint-migration-adapter.py',
             'scripts/test-checkpoint-migration-adapter.mjs',
             'scripts/test-checkpoint-context-isolated.py',
             'scripts/checkpoint-migration-context.mjs',
             'scripts/checkpoint-migration-postgres.mjs',
             'packages/db/migrations/meta/_journal.json',
             'packages/db/migration-drafts/0011_checkpoint_drafts.DRAFT.sql',
             'packages/db/migration-drafts/0014_checkpoint_editor_context.DRAFT.sql']
    journal = json.loads((repo / fixed[5]).read_text())['entries']
    if [e['idx'] for e in journal] != list(range(11)):
        raise RuntimeError('Registered migration scope changed')
    fixed += ['packages/db/migrations/' + e['tag'] + '.sql' for e in journal]
    driver = (repo / 'node_modules/postgres').resolve()
    if not driver.is_relative_to(repo.resolve()):
        raise RuntimeError('Installed driver escaped repository')
    if json.loads((driver / 'package.json').read_text())['version'] != '3.4.9':
        raise RuntimeError('Existing reviewed driver version required')
    pairs = [(name, repo / name) for name in fixed]
    pairs += [('node_modules/postgres/package.json', driver / 'package.json')]
    pairs += [('node_modules/postgres/' + str(f.relative_to(driver)), f)
              for f in sorted((driver / 'src').rglob('*.js'))]
    result = {}
    for name, source in pairs:
        if source.is_symlink() or not source.resolve().is_relative_to(repo.resolve()):
            raise RuntimeError('Unexpected source symlink or path')
        result[name] = hashlib.sha256(source.read_bytes()).hexdigest()
    return result


def plan(repo):
    sources = source_manifest(repo)
    value = {'scope': SCOPE, 'sources': sources, 'runtime_ready': not SOURCE_BLOCKERS,
             'runtime_blockers': SOURCE_BLOCKERS}
    digest = hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    return {**value, 'scope_sha256': digest}


def validate_approval(approval, digest, now):
    # Freshness/scope validation only. The trusted outer tool caller must verify
    # the actual human message and pass its authentic immutable ID/time.
    if set(approval) != {'owner_message_id', 'owner_approved_at', 'scope_sha256'} or \
       not isinstance(approval['owner_message_id'], str) or \
       not approval['owner_message_id'].startswith('Sentinel_') or \
       approval['scope_sha256'] != digest:
        raise RuntimeError('Exact fresh owner approval required')
    try:
        instant = dt.datetime.fromisoformat(approval['owner_approved_at'].replace('Z', '+00:00'))
    except (ValueError, AttributeError) as exc:
        raise RuntimeError('Authentic approval timestamp required') from exc
    if instant.tzinfo is None or instant.utcoffset() != dt.timedelta(0):
        raise RuntimeError('UTC approval timestamp required')
    current = dt.datetime.fromtimestamp(now, dt.timezone.utc)
    if not dt.timedelta(0) <= current - instant <= dt.timedelta(seconds=APPROVAL_SECONDS):
        raise RuntimeError('Approval is future or expired; never refresh it')


def private(path, uid, directory=False):
    s = path.lstat()
    if stat.S_ISLNK(s.st_mode) or s.st_uid != uid or stat.S_IMODE(s.st_mode) != (0o700 if directory else 0o600) or \
       not (stat.S_ISDIR(s.st_mode) if directory else stat.S_ISREG(s.st_mode)):
        raise RuntimeError('Private file/directory identity changed')


def write_private(path, value):
    if path.is_symlink():
        raise RuntimeError('Unexpected evidence symlink')
    with tempfile.NamedTemporaryFile('w', dir=path.parent, prefix='atomic-', delete=False) as stream:
        os.fchmod(stream.fileno(), 0o600)
        json.dump(value, stream, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
        pending = Path(stream.name)
    pending.replace(path)


class Controller:
    def __init__(self, repo=REPO, commands=None, target=TARGET, now=time.time, monotonic=time.monotonic):
        self.repo, self.target, self.now = Path(repo), Path(target), now
        self.monotonic = monotonic
        self.lifecycle = load_lifecycle(Path(__file__).resolve().parents[1])
        self.real = commands is None
        self.commands = commands or RuntimeCommands(self.lifecycle.Commands())
        self.uid = os.getuid()
        self.env = self.lifecycle.environment(self.repo)
        # Alternate roots are available only to injected fake commands, never CLI.
        if commands is None and self.target != TARGET:
            raise RuntimeError('Unexpected runtime target')

    def load(self):
        private(self.target, self.uid, True)
        private(self.target / 'control.json', self.uid)
        r = json.loads((self.target / 'control.json').read_text())
        times = ['created','deadline','cleanup_at','monotonic_created','monotonic_deadline','monotonic_cleanup_at']
        if not all(type(r.get(k)) in (int,float) and math.isfinite(r[k]) and r[k]>=0 for k in times) or \
                not re.fullmatch('[0-9a-f]{64}', r.get('scope_sha256','')) or \
                r.get('approval',{}).get('scope_sha256') != r['scope_sha256'] or \
                not isinstance(r.get('sources'),dict) or not r['sources']:
            raise RuntimeError('Invalid immutable control metadata')
        for name, digest in r['sources'].items():
            if Path(name).is_absolute() or '..' in Path(name).parts or '\\' in name or \
                    not re.fullmatch('[0-9a-f]{64}',digest):
                raise RuntimeError('Invalid snapshot source scope')
        if r.get('target') != str(self.target) or r.get('database') != DATABASE or \
           r.get('uid') != self.uid or r.get('port') != PORT or \
           r.get('deadline') != r.get('created', 0) + MAX_SECONDS or \
           r.get('cleanup_at') != r.get('deadline', 0) - CLEANUP_EARLY or \
           r.get('monotonic_deadline') != r.get('monotonic_created', 0) + MAX_SECONDS or \
           r.get('monotonic_cleanup_at') != r.get('monotonic_deadline', 0) - CLEANUP_EARLY:
            raise RuntimeError('Control scope changed')
        return r

    def preflight(self, prepared):
        self.commands.preflight(self.repo)
        if pwd.getpwuid(self.uid).pw_name != SCOPE['guard_owner']:
            raise RuntimeError('Expected OS bootstrap identity required')
        if self.target.exists() or self.target.is_symlink() or self.target.parent.exists():
            raise RuntimeError('Unused fresh target hierarchy required; do not adopt old data')
        ancestor = self.target.parent.parent
        if ancestor.is_symlink() or not ancestor.resolve().is_relative_to(Path('/home/anas/.local/share')):
            if self.real:
                raise RuntimeError('Unexpected existing target ancestor')
        if self.real and (not ancestor.is_dir() or ancestor.stat().st_uid != self.uid):
            raise RuntimeError('Existing owned private target ancestor required')
        if prepared != plan(self.repo):
            raise RuntimeError('Source scope changed')

    def command(self, args, record, *, timeout=30):
        remaining = min(record['cleanup_at'] - self.now(), record['monotonic_cleanup_at'] - self.monotonic())
        if remaining <= 0:
            raise RuntimeError('Cleanup window reached')
        if (self.target / 'evidence/cleanup.json').exists():
            raise RuntimeError('Closed target cannot be restarted')
        # Bounded startup commands cannot race the watchdog's shutdown.
        if Path(args[0]).name != 'node':
            with self.operation_lock():
                if (self.target / 'evidence/cleanup.json').exists():
                    raise RuntimeError('Cleanup won startup race')
                return self.commands.run(args, env=self.env, timeout=min(timeout, remaining), cwd=self.repo)
        return self.commands.run(args, env=self.env, timeout=min(timeout, remaining), cwd=self.repo)

    def operation_lock(self):
        fd = os.open(self.target / 'operation.lock', os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        stream = os.fdopen(fd, 'a')
        private(self.target / 'operation.lock', self.uid)
        fcntl.flock(stream, fcntl.LOCK_EX)
        return stream

    def verify_snapshot(self, record):
        for name, digest in record['sources'].items():
            file = self.target / 'snapshot' / name
            if file.is_symlink() or not file.resolve().is_relative_to(self.target / 'snapshot') or \
                    hashlib.sha256(file.read_bytes()).hexdigest() != digest:
                raise RuntimeError('Private snapshot changed')

    def guard_ready(self, pid, record):
        until = self.monotonic() + 5
        while self.monotonic() < until:
            ready = self.target / 'evidence/guard-ready.json'
            if ready.exists():
                private(ready, self.uid)
                proof = json.loads(ready.read_text())
                identity = self.commands.identity(pid)
                script = str(self.target / 'snapshot/scripts/test-checkpoint-migration-adapter.py')
                if proof != {'pid': pid, 'start_ticks': identity['start_ticks'],
                             'scope_sha256': record['scope_sha256'],
                             'control_sha256': hashlib.sha256((self.target / 'control.json').read_bytes()).hexdigest()} or \
                        identity['uid'] != self.uid or identity['args'][1:] != [script, 'watchdog']:
                    raise RuntimeError('Watchdog identity handshake failed')
                return
            if not self.commands.alive(pid):
                raise RuntimeError('Watchdog exited before arming')
            time.sleep(0.02)
        raise RuntimeError('Watchdog ready handshake timed out')

    def run(self, approval):
        if self.real and SOURCE_BLOCKERS:
            raise RuntimeError('Registered prerequisite ACL authority unresolved; source-only preparation')
        prepared = plan(self.repo)
        validate_approval(approval, prepared['scope_sha256'], self.now())
        self.preflight(prepared)
        validate_approval(approval, prepared['scope_sha256'], self.now())
        # Only after fresh approval and every read-only preflight succeeds.
        self.target.parent.mkdir(mode=0o700)
        self.target.mkdir(mode=0o700)
        for child in ['s', 'evidence', 'snapshot']:
            (self.target / child).mkdir(mode=0o700)
        created, mono = self.now(), self.monotonic()
        record = {'version': 1, 'target': str(self.target), 'uid': self.uid,
                  'database': DATABASE, 'port': PORT, 'created': created,
                  'deadline': created + MAX_SECONDS, 'cleanup_at': created + MAX_SECONDS - CLEANUP_EARLY,
                  'monotonic_created': mono, 'monotonic_deadline': mono + MAX_SECONDS,
                  'monotonic_cleanup_at': mono + MAX_SECONDS - CLEANUP_EARLY,
                  'boot_id': self.commands.boot_id(),
                  'parent_pid': os.getpid(), 'approval': dict(approval),
                  'parent_identity': self.commands.identity(os.getpid()),
                  'scope_sha256': prepared['scope_sha256'], 'sources': prepared['sources'],
                  'bootstrap': SCOPE['guard_owner'], 'actor': ACTOR, 'probe': PROBE}
        write_private(self.target / 'control.json', record)  # immutable; never overwritten
        result, failure = None, None
        try:
            for name, digest in prepared['sources'].items():
                origin = self.repo / name
                content = origin.read_bytes()
                if hashlib.sha256(content).hexdigest() != digest:
                    raise RuntimeError('Source changed during private snapshot')
                dest = self.target / 'snapshot' / name
                dest.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
                with dest.open('xb') as stream:
                    os.fchmod(stream.fileno(), 0o600)
                    stream.write(content)
            self.verify_snapshot(record)
            script = self.target / 'snapshot/scripts/test-checkpoint-migration-adapter.py'
            log = self.target / 'evidence/watchdog.log'
            log.touch(mode=0o600)
            guard_pid = self.commands.guard(script, cwd=self.repo, env=self.env, log=log)
            self.guard_ready(guard_pid, record)
            validate_approval(approval, prepared['scope_sha256'], self.now())
            pg = self.lifecycle.PG
            self.command([pg / 'initdb', '-D', self.target / 'data', '--no-locale', '-E', 'UTF8',
                          '--auth-local=trust', '--auth-host=reject', '--username=' + SCOPE['guard_owner']], record)
            self.command([pg / 'pg_ctl', '-D', self.target / 'data', '-l', self.target / 'evidence/postgres.log',
                          '-w', '-t', '20', '-o', "-c listen_addresses='' -c unix_socket_permissions=0700 -k " +
                          str(self.target / 's') + ' -p ' + PORT, 'start'], record)
            proof = self.command([pg / 'psql', '-X', '-h', self.target / 's', '-p', PORT, '-d', 'postgres',
                                  '-At', '-F', '\t', '-c', "SELECT current_setting('data_directory'),current_setting('listen_addresses')"], record)
            if proof.rstrip('\n').split('\t') != [str(self.target / 'data'), '']:
                raise RuntimeError('Private PostgreSQL target mismatch')
            self.command([pg / 'createdb', '-h', self.target / 's', '-p', PORT, DATABASE], record)
            self.command([self.repo / '.tools/node-v24.19.0-linux-x64/bin/node',
                          self.target / 'snapshot/scripts/test-checkpoint-migration-adapter.mjs',
                          '--execute-approved-private-rehearsal', self.target / 'control.json'], record,
                         timeout=MAX_SECONDS - CLEANUP_EARLY)
            private(self.target / 'evidence/assertions.json', self.uid)
            result = json.loads((self.target / 'evidence/assertions.json').read_text())
            if result.get('state') != 'passed' or result.get('scope_sha256') != record['scope_sha256'] or \
                    result.get('cleanup') != {'guard_removed': True, 'roles_disabled': True}:
                raise RuntimeError('No successful bound assertion receipt')
        except Exception as exc:
            failure = type(exc).__name__  # never persist raw SQL, DSN or command output
            write_private(self.target / 'evidence/controller-failure.json', {'kind': failure})
        finally:
            cleanup = self.stop()
        return {'passed': result is not None and failure is None, 'failure_kind': failure,
                'cleanup': cleanup, 'scope_sha256': record['scope_sha256']}

    def stop(self):
        r = self.load()
        fd = os.open(self.target / 'cleanup.lock', os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'a') as lock:
            private(self.target / 'cleanup.lock', self.uid)
            fcntl.flock(lock, fcntl.LOCK_EX)
            receipt = self.target / 'evidence/cleanup.json'
            data, pg = self.target / 'data', self.lifecycle.PG
            errors = []
            with self.operation_lock():
                try:
                    self.commands.terminate_owned(['initdb', 'pg_ctl'], data, self.uid)
                except Exception:
                    errors.append('startup_stop_error')
                pidfile = data / 'postmaster.pid'
                pid = None
                if pidfile.is_symlink():
                    raise RuntimeError('Unexpected postmaster record symlink')
                if pidfile.exists():
                    fields = pidfile.read_text().splitlines()
                    if len(fields) < 4 or fields[1] != str(data) or fields[3] != PORT:
                        raise RuntimeError('Postmaster record changed; stop not authorized')
                    pid = int(fields[0])
                    if not self.commands.owns_postgres(pid, data, self.uid):
                        raise RuntimeError('Postmaster process changed; stop not authorized')
                    try:
                        self.commands.run([pg / 'pg_ctl', '-D', data, '-m', 'fast', 'stop'],
                                          env=self.env, timeout=20, cwd=self.repo)
                    except Exception:
                        errors.append('graceful_stop_error')
                self.commands.terminate_owned(['postgres'], data, self.uid)
            if pidfile.exists() or list((self.target / 's').glob('.s.PGSQL.*')) or \
                    (pid is not None and self.commands.alive(pid)):
                raise RuntimeError('Private cluster cleanup remains pending')
            receipt_value = {'postgres_stopped': True, 'socket_files': 0, 'tcp': False,
                             'protected_data_retained': True, 'permanent_deletion': False,
                             'recovered_stop_errors': errors,
                             'scope_sha256': r['scope_sha256']}
            assertions = self.target / 'evidence/assertions.json'
            receipt_value['sql_cleanup_verified'] = assertions.exists() and \
                json.loads(assertions.read_text()).get('cleanup') == {'guard_removed': True, 'roles_disabled': True}
            write_private(receipt, receipt_value)
            return receipt_value

    def watchdog(self):
        r = self.load()
        self.verify_snapshot(r)
        proof = {'pid': os.getpid(), 'start_ticks': self.commands.identity(os.getpid())['start_ticks'],
                 'scope_sha256': r['scope_sha256'],
                 'control_sha256': hashlib.sha256((self.target / 'control.json').read_bytes()).hexdigest()}
        write_private(self.target / 'evidence/guard-ready.json', proof)
        while True:
            r = self.load()
            if (self.target / 'evidence/cleanup.json').exists():
                self.stop()  # A receipt never substitutes for a fresh stopped-state check.
                return
            try:
                parent = self.commands.identity(r['parent_pid']) if self.commands.alive(r['parent_pid']) else None
            except (FileNotFoundError, ProcessLookupError):
                parent = None
            if self.now() >= r['cleanup_at'] or self.monotonic() >= r['monotonic_cleanup_at'] or \
                    self.commands.boot_id() != r['boot_id'] or parent != r['parent_identity']:
                self.stop()
                return
            time.sleep(0.5)


class RuntimeCommands:
    """Reuse reviewed lifecycle commands; add only read-only process identity."""
    def __init__(self, base):
        self.base = base

    def __getattr__(self, name):
        return getattr(self.base, name)

    def boot_id(self):
        return Path('/proc/sys/kernel/random/boot_id').read_text().strip()

    def identity(self, pid):
        proc = Path('/proc') / str(pid)
        return {'uid': proc.stat().st_uid,
                'start_ticks': (proc / 'stat').read_text().rsplit(')', 1)[1].split()[19],
                'args': [v.decode() for v in (proc / 'cmdline').read_bytes().split(b'\0') if v]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['plan', 'run', 'cleanup', 'watchdog'])
    parser.add_argument('--approval-json', help='Authentic owner message/time/scope, not credentials')
    args = parser.parse_args()
    if args.mode == 'plan':
        print(json.dumps(plan(REPO), indent=2))
        return
    controller = Controller()
    if args.mode == 'run':
        if not args.approval_json:
            parser.error('Fresh exact owner approval required')
        result = controller.run(json.loads(args.approval_json))
        print(json.dumps(result))
        raise SystemExit(0 if result['passed'] else 1)
    if args.mode == 'cleanup':
        print(json.dumps(controller.stop()))
    else:
        controller.watchdog()


if __name__ == '__main__':
    main()
