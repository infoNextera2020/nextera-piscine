"""One explicitly approved, private-socket PostgreSQL rehearsal. Never reads .env."""
from pathlib import Path
import json
import os
import pwd
import shutil
import stat
import subprocess
import sys
import tempfile

root = Path(__file__).resolve().parents[1]
output = root / '.tools/checkpoint-draft-verification'
output.mkdir(parents=True, exist_ok=True)
control = output / 'control.json'
pg = Path('/usr/lib/postgresql/16/bin')
database = 'foundation_test_checkpoint_drafts_ephemeral'
port = '55449'

def command(args, **kwargs):
    return subprocess.run([str(a) for a in args], check=True, capture_output=True, text=True, **kwargs)

def environment():
    env = dict(os.environ)
    for key in ['DATABASE_URL','MIGRATION_DATABASE_URL','TEST_DATABASE_URL','PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','PGSERVICE']:
        env.pop(key, None)
    env['PGPASSFILE'] = '/dev/null'
    env['PGSERVICEFILE'] = '/dev/null'
    env['PATH'] = str(root / '.tools/node-v24.19.0-linux-x64/bin') + os.pathsep + env['PATH']
    return env

def load():
    data = json.loads(control.read_text())
    temporary = Path(data['directory'])
    if temporary.resolve().parent != Path(tempfile.gettempdir()).resolve() or not temporary.name.startswith('nextera-checkpoint-draft-test-') or temporary.is_symlink():
        raise SystemExit('Unrecognized disposable target; no action taken.')
    if data['uid'] != os.getuid() or data['database'] != database or data['port'] != port:
        raise SystemExit('Disposable identity mismatch; no action taken.')
    if temporary.exists() and (temporary.stat().st_uid != os.getuid() or stat.S_IMODE(temporary.stat().st_mode) != 0o700):
        raise SystemExit('Private directory ownership/mode mismatch; no action taken.')
    return data, temporary

def verify(data, temporary):
    socket = temporary / 'socket'
    result = command([pg/'psql','-X','-h',socket,'-p',port,'-d','postgres','-At','-F','\t','-c',"SELECT current_setting('data_directory'),current_setting('listen_addresses')"],env=environment()).stdout.strip('\n').split('\t')
    if result != [str(temporary/'data'),'']:
        raise SystemExit('Server is not the approved private cluster; no mutation performed.')
    return socket

mode = sys.argv[1] if len(sys.argv) == 2 else ''
if mode == 'start':
    if control.exists():
        raise SystemExit('A rehearsal control record already exists; inspect it, do not start another cluster.')
    if not (pg/'initdb').is_file():
        raise SystemExit('Existing PostgreSQL 16 binary unavailable; no install attempted.')
    temporary = Path(tempfile.mkdtemp(prefix='nextera-checkpoint-draft-test-'))
    temporary.chmod(0o700)
    socket = temporary/'socket'
    socket.mkdir(mode=0o700)
    data = {'directory':str(temporary),'uid':os.getuid(),'database':database,'port':port,'started':False,'attempts':0}
    control.write_text(json.dumps(data,indent=2));control.chmod(0o600)
    try:
        command([pg/'initdb','-D',temporary/'data','--no-locale','-E','UTF8','--auth-local=trust','--auth-host=reject'],env=environment())
        command([pg/'pg_ctl','-D',temporary/'data','-l',output/'postgres.log','-o',f"-c listen_addresses='' -c unix_socket_permissions=0700 -k {socket} -p {port}",'start'],env=environment())
        data['started']=True
        data['pid']=int((temporary/'data/postmaster.pid').read_text().splitlines()[0])
        control.write_text(json.dumps(data,indent=2))
        verify(data,temporary)
        print(json.dumps({'started':True,'database':database,'private_socket':str(socket),'pid':data['pid'],'tcp_listener':False,'application_passwords_or_tokens_created':False}))
    except Exception:
        # Record the exact path for bounded cleanup even if startup outcome is uncertain.
        if (temporary/'data/postmaster.pid').exists():
            data['started']=True;data['pid']=int((temporary/'data/postmaster.pid').read_text().splitlines()[0]);control.write_text(json.dumps(data,indent=2))
        raise
elif mode == 'test':
    data,temporary=load();socket=verify(data,temporary)
    # Only the fixed synthetic database inside the verified one-off cluster is reset.
    command([pg/'dropdb','--if-exists','--force','-h',socket,'-p',port,'--maintenance-db=postgres',database],env=environment())
    command([pg/'createdb','-h',socket,'-p',port,database],env=environment())
    env=environment();env.update({'DRAFT_TEST_SOCKET':str(socket),'DRAFT_TEST_DB':database,'DRAFT_TEST_USER':pwd.getpwuid(os.getuid()).pw_name,'DRAFT_TEST_OUTPUT':str(output)})
    data['attempts']+=1;control.write_text(json.dumps(data,indent=2))
    result=subprocess.run(['/mnt/c/Users/lap/AppData/Roaming/npm/pnpm','exec','vitest','run','--config','packages/db/vitest.drafts.config.ts'],cwd=root,env=env,capture_output=True,text=True)
    (output/f"tests-attempt-{data['attempts']}.log").write_text(result.stdout+result.stderr)
    print(result.stdout+result.stderr)
    print(json.dumps({'test_exit':result.returncode,'attempt':data['attempts'],'same_temporary_cluster':True,'cleanup_still_required':True}))
    raise SystemExit(result.returncode)
elif mode == 'cleanup':
    data,temporary=load();stopped=True
    if temporary.exists() and (temporary/'data/postmaster.pid').exists():
        verify(data,temporary)
        stop=subprocess.run([str(pg/'pg_ctl'),'-D',str(temporary/'data'),'-m','fast','stop'],env=environment(),capture_output=True,text=True)
        (output/'stop.log').write_text(stop.stdout+stop.stderr);stopped=stop.returncode==0
    sockets=list((temporary/'socket').glob('.s.PGSQL.*')) if (temporary/'socket').exists() else []
    pid_alive=False
    if data.get('pid'):
        try:os.kill(data['pid'],0);pid_alive=True
        except ProcessLookupError:pass
    removed=not temporary.exists()
    if stopped and not sockets and not pid_alive and temporary.exists():
        # load() verified this resolved absolute target is exactly the created /tmp child.
        shutil.rmtree(temporary);removed=not temporary.exists()
    report={'postgres_stopped':stopped,'temporary_cluster_removed':removed,'recorded_pid_alive':pid_alive,'remaining_socket_files':len(sockets),'tcp_listener':False,'retained_database_touched':False,'application_login_passwords_or_auth_tokens_created':False,'attempts':data['attempts']}
    if not removed:report['cleanup_required_path']=str(temporary)
    (output/'cleanup.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
    if not stopped or not removed or pid_alive or sockets:raise SystemExit('Cleanup incomplete; preserve evidence and report exact blocker.')
else:
    raise SystemExit('Use start, test, or cleanup. Requires separate explicit rehearsal authorization.')
