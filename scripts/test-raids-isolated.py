"""Linux-only, credential-free disposable Raid contract verification. Never reads .env."""
from pathlib import Path
import json
import os
import pwd
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
output = root / '.tools/raid-verification'
output.mkdir(parents=True, exist_ok=True)
postgres_bin = Path('/usr/lib/postgresql/16/bin')
if not (postgres_bin / 'initdb').is_file():
    raise SystemExit('Existing PostgreSQL 16 runtime required; nothing is installed automatically.')
temporary = Path(tempfile.mkdtemp(prefix='nextera-raid-test-'))
temporary.chmod(0o700)
data = temporary / 'data'
socket = temporary / 'socket'
socket.mkdir(mode=0o700)
started = False
exit_code = 1
try:
    subprocess.run([str(postgres_bin / 'initdb'), '-D', str(data), '--no-locale', '-E', 'UTF8', '--auth-local=trust', '--auth-host=reject'], check=True, capture_output=True, text=True)
    subprocess.run([str(postgres_bin / 'pg_ctl'), '-D', str(data), '-l', str(output / 'postgres.log'), '-o', f"-c listen_addresses='' -c unix_socket_permissions=0700 -k {socket} -p 55447", 'start'], check=True, capture_output=True, text=True)
    started = True
    subprocess.run([str(postgres_bin / 'createdb'), '-h', str(socket), '-p', '55447', 'foundation_test_raid_ephemeral'], check=True, capture_output=True, text=True)
    environment = dict(os.environ)
    environment.update({'RAID_TEST_SOCKET': str(socket), 'RAID_TEST_DB': 'foundation_test_raid_ephemeral', 'RAID_TEST_USER': pwd.getpwuid(os.getuid()).pw_name})
    result = subprocess.run(['pnpm', 'test:db', 'packages/db/tests/integration/raids.test.ts'], cwd=root, env=environment, capture_output=True, text=True)
    (output / 'tests.log').write_text(result.stdout + result.stderr)
    print(result.stdout + result.stderr)
    exit_code = result.returncode
finally:
    stopped = not started
    if started:
        stop = subprocess.run([str(postgres_bin / 'pg_ctl'), '-D', str(data), '-m', 'fast', 'stop'], capture_output=True, text=True)
        stopped = stop.returncode == 0
    removed = False
    if stopped:
        # Never recursively remove anything outside the exact disposable directory created above.
        assert temporary.resolve().parent == Path(tempfile.gettempdir()).resolve()
        assert temporary.name.startswith('nextera-raid-test-')
        shutil.rmtree(temporary)
        removed = not temporary.exists()
    report = {'postgres_stopped': stopped, 'temporary_cluster_removed': removed, 'tcp_listener': False,
              'application_login_roles_or_passwords_provisioned': False, 'auth_tokens_issued': False,
              'retained_database_touched': False,
              'bootstrap_identity': 'Ephemeral initdb bootstrap identity only, confined to a private socket; no application login credential'}
    if not stopped:
        report['cleanup_required_path'] = str(temporary)
    (output / 'cleanup.json').write_text(json.dumps(report, indent=2))
    print(json.dumps(report))
    if not stopped or not removed:
        raise SystemExit('Disposable cluster cleanup requires attention; evidence/data retained. See .tools/raid-verification/cleanup.json')
raise SystemExit(exit_code)
