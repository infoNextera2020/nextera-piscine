"""Prepared, opt-in SQL0011+0014 rehearsal. No runtime action occurs on import.

Execution needs separate approval. Unit tests inject a fake command adapter;
the plan command creates no files, processes, sockets, roles or credentials.
"""
from pathlib import Path
import argparse
import fcntl
import json
import math
import os
import pwd
import signal
import stat
import subprocess
import sys
import tempfile
import time

DATABASE = 'foundation_test_checkpoint_context_20261028'
PORT = '55450'  # Unix socket filename only; listen_addresses is empty.
PREFIX = '01coding-checkpoint-context-test-'
MAX_SECONDS = 1800
PG = Path('/usr/lib/postgresql/16/bin')
PLAN = {
    'database': DATABASE, 'socket_identifier': PORT, 'tcp': False,
    'migrations': ['registered0000-0010', 'draft0011', 'draft0014'],
    'nologin_roles': ['nextera_web', 'nextera_checkpoint_owner',
                     'nextera_result_application', 'nextera_raid_owner', 'draft_untrusted'],
    'application_credentials_or_auth_accounts': False,
    'maximum_seconds': MAX_SECONDS, 'cleanup': 'stop and retain private data/evidence',
    'policy': 'synthetic test values only; no production policy configured',
    'run_or_invitation_or_new_scoring_schema': False,
}


def environment(root):
    # Never read .env, pgpass, service files or ambient connection variables.
    return {'PATH': str(root / '.tools/node-v24.19.0-linux-x64/bin') +
            ':/mnt/c/Users/lap/AppData/Roaming/npm:/usr/bin:/bin',
            'PGPASSFILE': '/dev/null', 'PGSERVICEFILE': '/dev/null',
            'LANG': 'C.UTF-8', 'NEXT_TELEMETRY_DISABLED': '1'}


def validate_record(record, temporary_root, uid):
    path = Path(record['directory'])
    if (path.is_symlink() or path.resolve().parent != temporary_root.resolve()
            or not path.name.startswith(PREFIX) or path.name == PREFIX
            or record.get('uid') != uid or record.get('database') != DATABASE
            or record.get('port') != PORT or record.get('version') != 1):
        raise RuntimeError('Unrecognized private rehearsal target')
    if path.exists() and (path.stat().st_uid != uid or
                         stat.S_IMODE(path.stat().st_mode) != 0o700):
        raise RuntimeError('Private directory ownership/mode changed')
    created, deadline = record['created'], record['deadline']
    if type(created) not in (float, int) or type(deadline) not in (float, int) or \
            not math.isfinite(created) or not math.isfinite(deadline) or \
            deadline <= created or deadline > created + MAX_SECONDS:
        raise RuntimeError('Invalid bounded rehearsal clock')
    return path


class Commands:
    def preflight(self, root):
        if sys.platform != 'linux' or not hasattr(os, 'pidfd_open') or not hasattr(signal, 'pidfd_send_signal'):
            raise RuntimeError('Supported Linux process-identity guard required')
        for name in ['initdb', 'pg_ctl', 'postgres', 'psql', 'createdb']:
            if not (PG / name).is_file():
                raise RuntimeError('Existing PostgreSQL16 tooling required; no install attempted')
        if not (root / '.tools/node-v24.19.0-linux-x64/bin/node').is_file():
            raise RuntimeError('Existing reviewed Node runtime required')

    def run(self, args, *, env, timeout, cwd=None):
        return subprocess.run([str(v) for v in args], env=env, cwd=cwd, timeout=timeout,
                              check=True, capture_output=True, text=True).stdout

    def guard(self, script, *, cwd, env, log):
        with log.open('a') as stream:
            return subprocess.Popen([sys.executable, str(script), 'watchdog'], cwd=cwd,
                                    env=env, stdin=subprocess.DEVNULL, stdout=stream,
                                    stderr=subprocess.STDOUT, close_fds=True,
                                    start_new_session=True).pid

    def alive(self, pid):
        try:
            os.kill(pid, 0)
            return True
        except ProcessLookupError:
            return False

    def owns_postgres(self, pid, data, uid):
        proc = Path('/proc') / str(pid)
        try:
            argv = (proc / 'cmdline').read_bytes().split(b'\0')
            return (proc.stat().st_uid == uid and len(argv) >= 3 and
                    argv[0] == str(PG / 'postgres').encode() and
                    argv[1:3] == [b'-D', str(data).encode()])
        except FileNotFoundError:
            return False

    def owned(self, names, data, uid):
        matches = []
        for proc in Path('/proc').iterdir():
            if not proc.name.isdigit():
                continue
            try:
                if proc.stat().st_uid != uid:
                    continue
                argv = (proc / 'cmdline').read_bytes().split(b'\0')
                if not argv or argv[0] not in [str(PG / n).encode() for n in names]:
                    continue
                if any(argv[i:i+2] == [b'-D', str(data).encode()] for i in range(len(argv)-1)):
                    matches.append(int(proc.name))
            except FileNotFoundError:
                continue
        return matches

    def terminate_owned(self, names, data, uid):
        # A pidfd prevents PID reuse from redirecting a signal to another process.
        deadline = time.monotonic() + 5
        while self.owned(names, data, uid):
            for pid in self.owned(names, data, uid):
                try:
                    fd = os.pidfd_open(pid)
                    try:
                        if pid in self.owned(names, data, uid):
                            signal.pidfd_send_signal(fd, signal.SIGTERM)
                    finally:
                        os.close(fd)
                except ProcessLookupError:
                    pass
            if time.monotonic() >= deadline:
                raise RuntimeError('Owned startup process still needs cleanup')
            time.sleep(0.05)


class Rehearsal:
    def __init__(self, root, commands=None, temporary_root=None, now=time.time):
        self.root = Path(root).resolve()
        self.output = self.root / '.tools/checkpoint-context-verification'
        self.control = self.output / 'control.json'
        self.commands = commands or Commands()
        self.temporary_root = Path(temporary_root or tempfile.gettempdir()).resolve()
        self.uid, self.now = os.getuid(), now
        self.env = environment(self.root)

    def save(self, record):
        validate_record(record, self.temporary_root, self.uid)
        if self.output.is_symlink() or not self.output.resolve().is_relative_to(self.root):
            raise RuntimeError('Evidence target must stay inside the existing workspace')
        self.output.mkdir(mode=0o700, parents=True, exist_ok=True)
        if self.output.stat().st_uid != self.uid or stat.S_IMODE(self.output.stat().st_mode) != 0o700:
            raise RuntimeError('Evidence directory must be private and owned')
        if self.control.is_symlink():
            raise RuntimeError('Control target changed')
        with tempfile.NamedTemporaryFile('w', prefix='control-', suffix='.json', dir=self.output, delete=False) as stream:
            path = Path(stream.name)
            os.fchmod(stream.fileno(), 0o600)
            json.dump(record, stream, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        path.replace(self.control)

    def load(self):
        if self.control.is_symlink() or self.control.stat().st_uid != self.uid or \
                stat.S_IMODE(self.control.stat().st_mode) != 0o600:
            raise RuntimeError('Control identity changed')
        record = json.loads(self.control.read_text())
        validate_record(record, self.temporary_root, self.uid)
        return record

    def command(self, args, record, *, timeout=30, env=None):
        remaining = record['deadline'] - self.now()
        if remaining <= 0:
            raise RuntimeError('Rehearsal expired; cleanup required')
        return self.commands.run(args, env=self.env if env is None else env,
                                 timeout=max(0.1, min(timeout, remaining)), cwd=self.root)

    def verify(self, record):
        temporary = validate_record(record, self.temporary_root, self.uid)
        result = self.commands.run(
            [PG / 'psql', '-X', '-h', temporary / 'socket', '-p', PORT, '-d', 'postgres',
             '-At', '-F', '\t', '-c',
             "SELECT current_setting('data_directory'),current_setting('listen_addresses')"],
            env=self.env, timeout=5, cwd=self.root).rstrip('\n').split('\t')
        if result != [str(temporary / 'data'), '']:
            raise RuntimeError('Target is not the recorded private cluster')
        return temporary

    def stop(self):
        # Main and expiry guard can both observe failure; serialize their cleanup.
        fd = os.open(self.output / 'cleanup.lock', os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'a') as lock:
            info = os.fstat(lock.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_uid != self.uid or info.st_nlink != 1 or stat.S_IMODE(info.st_mode) != 0o600:
                raise RuntimeError('Cleanup lock identity changed')
            fcntl.flock(lock, fcntl.LOCK_EX)
            return self._stop()

    def _stop(self):
        record = self.load()
        temporary = validate_record(record, self.temporary_root, self.uid)
        data = temporary / 'data'
        # Stop only matching startup commands before checking a partially started server.
        self.commands.terminate_owned(['initdb', 'pg_ctl'], data, self.uid)
        pidfile = data / 'postmaster.pid'
        pid = None
        if pidfile.exists():
            fields = pidfile.read_text().splitlines()
            if len(fields) < 4 or fields[1] != str(data) or fields[3] != PORT:
                raise RuntimeError('Postmaster identity changed; no stop attempted')
            pid = int(fields[0])
            if not self.commands.owns_postgres(pid, data, self.uid):
                raise RuntimeError('Postmaster process identity changed; no stop attempted')
            self.commands.run([PG / 'pg_ctl', '-D', data, '-m', 'fast', 'stop'],
                              env=self.env, timeout=20, cwd=self.root)
        # A crash can occur before postmaster.pid is written. Match the private data path.
        self.commands.terminate_owned(['postgres'], data, self.uid)
        sockets = list((temporary / 'socket').glob('.s.PGSQL.*'))
        alive = pid is not None and self.commands.alive(pid)
        if pidfile.exists() or sockets or alive:
            raise RuntimeError('Recorded cluster still needs cleanup')
        record['stopped'] = True
        record['cleanup'] = {'postgres_stopped': True, 'socket_files': 0,
                             'retained_data_directory': str(data), 'permanent_deletion': False,
                             'retained_database_touched': False}
        self.save(record)
        return record['cleanup']

    def run(self, script):
        if self.control.exists():
            raise RuntimeError('Existing control record; inspect uncertain outcome before retry')
        self.commands.preflight(self.root)
        # A new private child only. This never adopts an existing data directory.
        temporary = Path(tempfile.mkdtemp(prefix=PREFIX, dir=self.temporary_root))
        temporary.chmod(0o700)
        (temporary / 'socket').mkdir(mode=0o700)
        created = self.now()
        record = {'version': 1, 'uid': self.uid, 'directory': str(temporary),
                  'database': DATABASE, 'port': PORT, 'created': created,
                  'deadline': created + MAX_SECONDS, 'parent_pid': os.getpid(),
                  'stopped': False, 'stage': 'prepared'}
        self.save(record)
        succeeded = False
        try:
            # Arm the separately disclosed expiry/parent-loss guard before creating a server.
            record['watchdog_pid'] = self.commands.guard(script, cwd=self.root, env=self.env,
                                                         log=self.output / 'watchdog.log')
            self.save(record)
            self.command([PG / 'initdb', '-D', temporary / 'data', '--no-locale', '-E', 'UTF8',
                          '--auth-local=trust', '--auth-host=reject',
                          '--username=' + pwd.getpwuid(self.uid).pw_name], record)
            self.command([PG / 'pg_ctl', '-D', temporary / 'data', '-l', self.output / 'postgres.log',
                          '-w', '-t', '20', '-o', "-c listen_addresses='' -c unix_socket_permissions=0700 -k " +
                          str(temporary / 'socket') + ' -p ' + PORT, 'start'], record)
            self.verify(record)
            record['stage'] = 'postgres_verified'
            self.save(record)
            self.command([PG / 'createdb', '-h', temporary / 'socket', '-p', PORT, DATABASE], record)
            test_env = {**self.env, 'DRAFT_CONTEXT_REHEARSAL': '0011+0014',
                        'DRAFT_TEST_SOCKET': str(temporary / 'socket'), 'DRAFT_TEST_DB': DATABASE,
                        'DRAFT_TEST_USER': pwd.getpwuid(self.uid).pw_name,
                        'DRAFT_TEST_OUTPUT': str(self.output)}
            result = self.command(['/mnt/c/Users/lap/AppData/Roaming/npm/pnpm', 'exec', 'vitest',
                                   'run', '--config', 'packages/db/vitest.context.config.ts'],
                                  record, timeout=MAX_SECONDS, env=test_env)
            (self.output / 'tests.log').write_text(result)
            record['stage'] = 'tests_passed'
            self.save(record)
            succeeded = True
        except Exception as failure:
            record['stage'] = 'failed'
            record['failure_kind'] = type(failure).__name__
            self.save(record)
            if isinstance(failure, subprocess.CalledProcessError):
                (self.output / 'tests-or-command-failure.log').write_text((failure.stdout or '') + (failure.stderr or ''))
                (self.output / 'tests-or-command-failure.log').chmod(0o600)
            raise
        finally:
            # Also applies after partial init/start/test failures. Never deletes retained data.
            cleanup = self.stop()
        return {'tests_passed': succeeded, 'cleanup': cleanup, 'real_postgres': True}

    def watchdog(self):
        while True:
            record = self.load()
            if record.get('stopped'):
                return
            if self.now() >= record['deadline'] or not self.commands.alive(record['parent_pid']):
                print(json.dumps(self.stop()))
                return
            time.sleep(1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['plan', 'run', 'cleanup', 'watchdog'])
    parser.add_argument('--ack-private-synthetic-only', action='store_true')
    args = parser.parse_args()
    if args.mode == 'plan':
        print(json.dumps(PLAN, indent=2))
        return
    if args.mode == 'run' and not args.ack_private_synthetic_only:
        parser.error('Separate runtime approval and explicit bounded-scope acknowledgment required')
    rehearsal = Rehearsal(Path(__file__).resolve().parents[1])
    if args.mode == 'run':
        print(json.dumps(rehearsal.run(Path(__file__).resolve()), indent=2))
    elif args.mode == 'cleanup':
        print(json.dumps(rehearsal.stop(), indent=2))
    else:
        rehearsal.watchdog()


if __name__ == '__main__':
    main()
