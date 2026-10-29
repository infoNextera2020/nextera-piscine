"""Opt-in runtime adapter. Imports, --plan and unit tests never provision resources.

No runtime action is authorized by this source. --execute requires separate fresh
approval and browser-context receipts. --watch/--cleanup only accept our own lease.
"""
from pathlib import Path
import argparse
import fcntl
import hashlib
import importlib.util
import io
import json
import os
import select
import signal
import socket
import stat
import subprocess
import sys
import tarfile
import time

PLAN_MODULE = Path(__file__).with_name('checkpoint-auth-rehearsal.py')
spec = importlib.util.spec_from_file_location('checkpoint_auth_scope', PLAN_MODULE)
scope = importlib.util.module_from_spec(spec); sys.modules[spec.name] = scope; spec.loader.exec_module(scope)


def protected(path, value):
    path=Path(path);tmp=path.with_name(path.name+'.next')
    fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w') as f:json.dump(value,f,indent=2);f.flush();os.fsync(f.fileno())
    os.replace(tmp,path)
    fd=os.open(path.parent,os.O_DIRECTORY)
    try:os.fsync(fd)
    finally:os.close(fd)


def tick(pid):
    return Path('/proc',str(pid),'stat').read_text().rsplit(')',1)[1].split()[19]


def browser_context(proof, now):
    # This proves current supported transport/context only, not future origin reachability.
    return (proof.get('browser')=='Chrome extension' and
            proof.get('url')=='http://127.0.0.1:3118/review/auth/login' and
            proof.get('denied_route_retried') is False and
            type(proof.get('observed_at')) in (int,float) and 0<=now-proof['observed_at']<=300)


def guard_should_stop(control,now,read_ticks=tick,monotonic=time.monotonic):
    try:parent_alive=read_ticks(control['parent_pid'])==control['parent_ticks']
    except OSError:parent_alive=False
    return now>=control['deadline']-180 or monotonic()>=control.get('monotonic_deadline',float('inf'))-180 or not parent_alive


def validate_bootstrap_recovery(control,outcome,cleanup,now,expected_deadline,sql_started,learners_started):
    plan=scope.Plan()
    if control.get('project')!=plan.project or control.get('database')!=plan.database or control.get('scope_sha256')!=scope.scope_digest():raise scope.ScopeError('Recovery target mismatch')
    if control.get('deadline')!=expected_deadline or control.get('deadline')-control.get('started')!=plan.maximum_seconds or now>=expected_deadline-180:raise scope.ScopeError('No recovery window or changed deadline')
    if outcome.get('started')!=control['started'] or outcome.get('deadline')!=control['deadline'] or outcome.get('assertions_passed') is not False or outcome.get('cleanup_verified') is not True:raise scope.ScopeError('Unverified failure outcome')
    if cleanup.get('access_disabled') is not True or cleanup.get('retained') is not True or cleanup.get('no_permanent_deletion') is not True:raise scope.ScopeError('Cleanup must be verified')
    steps=[v.get('starting') for v in control.get('phases',[]) if isinstance(v,dict) and 'starting' in v]
    if steps!=['stage','start'] or sql_started or learners_started:raise scope.ScopeError('Only known pre-SQL bootstrap failure may recover')
    return True


def validate_effective(c,plan):
    if c.get('name')!=plan.project or set(c.get('services',{}))!=set(plan.services):raise scope.ScopeError('Wrong effective project/services')
    for name,s in c['services'].items():
        if s.get('container_name')!=plan.project+'-'+name or s.get('restart')!='no' or s.get('privileged') or s.get('network_mode'):raise scope.ScopeError('Unsafe service isolation')
        if '@sha256:' not in s.get('image',''):raise scope.ScopeError('Image must be pinned')
        ports=s.get('ports',[])
        if name in ['db','api-gw']:
            if len(ports)!=1 or ports[0].get('host_ip')!='127.0.0.1' or int(ports[0].get('published',0))!=dict(db=56532,**{'api-gw':56531})[name]:raise scope.ScopeError('Wrong binding')
        elif ports:raise scope.ScopeError('Unexpected binding')
        for v in s.get('volumes',[]):
            if v.get('type')=='bind' and (not Path(v['source']).resolve().is_relative_to(Path(plan.directory).resolve()) or 'docker.sock' in v['source']):raise scope.ScopeError('Mount escapes fresh run')
    for name,v in c.get('volumes',{}).items():
        if v.get('external') or v.get('name')!=plan.project+'-'+name:raise scope.ScopeError('External/reused volume')
    for v in c.get('networks',{}).values():
        if v.get('external') or v.get('name',plan.project+'_default')!=plan.project+'_default':raise scope.ScopeError('External/reused network')
    for name in ['auth','rest','storage']:
        if '/'+plan.database not in json.dumps(c['services'][name].get('environment',{})):raise scope.ScopeError('Split product/auth/storage database')


GATE = "import os,sys; token=sys.stdin.buffer.read(1); sys.exit(0) if token!=b'1' else os.execvpe(sys.argv[1],sys.argv[1:],os.environ)"


class Commands:
    def run(self,args,*,env,cwd,input=None,timeout=60):
        control=env.get('CHECKPOINT_REHEARSAL_CONTROL')
        launch=[sys.executable,'-c',GATE,*args]
        p=subprocess.Popen(launch,env=env,cwd=cwd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
        record={'pid':p.pid,'ticks':tick(p.pid),'cwd':str(Path(cwd).resolve()),'uid':os.getuid(),'finished':False}
        if control:
            try:protected(Path(control)/'phase-process.json',record)
            except Exception:
                p.communicate(input=b'',timeout=5)  # EOF without GO: no sensitive command executes.
                raise
        try:
            stdout,stderr=p.communicate(input=b'1'+(input or b''),timeout=timeout)
        except subprocess.TimeoutExpired:
            if tick(p.pid)==record['ticks']:os.killpg(p.pid,signal.SIGTERM)
            p.communicate(timeout=10)
            raise scope.ScopeError('Bounded command timeout; no automatic retry.')
        finally:
            if control:protected(Path(control)/'phase-process.json',{**record,'finished':p.poll() is not None})
        if p.returncode:
            if control:
                fd=os.open(Path(control)/'command-failure.private.log',os.O_WRONLY|os.O_CREAT|os.O_APPEND,0o600)
                with os.fdopen(fd,'ab') as f:f.write(stderr)
            raise scope.ScopeError('Command failed; protected diagnostics retained, not returned.')
        return stdout


class LiveAdapter:
    kind='local_docker_auth_db_http'
    def __init__(self,repo,template,browser,commands=None,now=time.time):
        self.repo=Path(repo).resolve();self.template=Path(template).resolve();self.browser=browser;self.commands=commands or Commands();self.now=now
        self.plan=scope.Plan();self.run=Path(self.plan.directory)
        self.env={'PATH':str(self.repo/'.tools/node-v24.19.0-linux-x64/bin')+':/mnt/c/Users/lap/AppData/Roaming/npm:/usr/bin:/bin','HOME':str(Path.home()),'LANG':'C.UTF-8','NEXT_TELEMETRY_DISABLED':'1'}
        self.env['DOCKER_CONFIG']=str(self.run/'docker-client')
        self.node=str(self.repo/'.tools/node-v24.19.0-linux-x64/bin/node')
        self.broker=str((self.run/'adapter-code/checkpoint-auth-runtime.mjs') if (self.run/'adapter-code/checkpoint-auth-runtime.mjs').exists() else (self.repo/'scripts/checkpoint-auth-runtime.mjs'))
    def command(self,args,timeout=60,input=None):return self.commands.run([str(a) for a in args],env=self.env,cwd=self.repo,input=input,timeout=timeout)
    def compose(self,*args):return ['docker','compose','--project-name',self.plan.project,'--project-directory',self.run/'stack','--env-file',self.run/'stack/.env','-f',self.run/'stack/docker-compose.yml',*args]
    def preflight(self,plan):
        if plan!=self.plan or self.run.exists():raise scope.ScopeError('Fresh target required; inspect uncertain state, do not reuse.')
        if not browser_context(self.browser,self.now()):raise scope.ScopeError('Fresh supported browser context receipt required.')
        lock=json.loads((self.repo/'infra/checkpoint-auth-rehearsal/source-lock.json').read_text())
        if lock['commit']!=plan.upstream_commit or set(lock['images'])!=set(plan.services):raise scope.ScopeError('Wrong source lock')
        for name,digest in lock['files'].items():
            p=self.template/name
            if p.is_symlink() or not p.resolve().is_relative_to(self.template) or hashlib.sha256(p.read_bytes()).hexdigest()!=digest:raise scope.ScopeError('Template identity mismatch')
        for image in lock['images'].values():self.command(['docker','image','inspect',image])
        if self.command(['docker','ps','-aq','--no-trunc','--filter','label=com.docker.compose.project='+plan.project]).strip():raise scope.ScopeError('Project already exists')
        volumes=self.command(['docker','volume','ls','-q']).decode().splitlines()
        if any(v.startswith(plan.project+'-') for v in volumes):raise scope.ScopeError('Run volumes already exist')
        if self.command(['docker','network','ls','-q','--filter','label=com.docker.compose.project='+plan.project]).strip():raise scope.ScopeError('Run network already exists')
        for _,host,port in plan.bindings:
            with socket.socket() as s:s.settimeout(1);busy=s.connect_ex((host,port))==0
            if busy:raise scope.ScopeError('Proposed port busy')
        self.head=self.command(['git','rev-parse','HEAD']).decode().strip()
        return {**{k:True for k in ['fresh_directory','fresh_project','fresh_volumes','ports_available','pinned_images_available','template_digest_verified','browser_target_permitted','cleanup_supported']},'database':plan.database,'project':plan.project,'migrations':list(plan.migrations),'bindings':[list(x) for x in plan.bindings],'role_memberships':list(plan.role_memberships),'services':list(plan.services)}
    def reserve_fresh(self,plan,outcome):
        # Existing ancestors may exist; none may resolve through a symlink.
        for p in [self.run,*self.run.parents]:
            if p.is_symlink():raise scope.ScopeError('Symlink in private run path')
        self.run.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        self.run.mkdir(mode=0o700);os.chmod(self.run,0o700)
        (self.run/'docker-client').mkdir(mode=0o700)
        control={**outcome,'project':plan.project,'database':plan.database,'uid':os.getuid(),'parent_pid':os.getpid(),'parent_ticks':tick(os.getpid()),'template':str(self.template),'repo':str(self.repo),'head':self.head,'phases':[],'monotonic_deadline':time.monotonic()+plan.maximum_seconds,'baseline_containers':self.command(['docker','ps','-aq','--no-trunc']).decode().splitlines()}
        code=self.run/'adapter-code';code.mkdir(mode=0o700)
        for name in ['checkpoint-auth-live-adapter.py','checkpoint-auth-rehearsal.py','checkpoint-auth-runtime.mjs']:
            data=(self.repo/'scripts'/name).read_bytes();target=code/name
            fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
            with os.fdopen(fd,'wb') as f:f.write(data);f.flush();os.fsync(f.fileno())
        self.broker=str(code/'checkpoint-auth-runtime.mjs')
        protected(self.run/'control.json',control);return str(self.run)
    def read(self):
        if self.run!=Path(scope.Plan().directory) or self.run.is_symlink() or self.run.stat().st_uid!=os.getuid() or stat.S_IMODE(self.run.stat().st_mode)!=0o700:raise scope.ScopeError('Unrecognized private lease')
        c=json.loads((self.run/'control.json').read_text())
        if c['project']!=self.plan.project or c['database']!=self.plan.database or c['uid']!=os.getuid() or c['scope_sha256']!=scope.scope_digest():raise scope.ScopeError('Lease mismatch')
        return c
    def arm_guard(self,reservation,deadline,**kwargs):
        if reservation!=str(self.run) or kwargs!={'parent_loss':True,'retain':True}:raise scope.ScopeError('Wrong guard request')
        log=os.open(self.run/'guard.private.log',os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        try:p=subprocess.Popen([sys.executable,str(self.run/'adapter-code/checkpoint-auth-live-adapter.py'),'--watch'],env=self.env,cwd=self.repo,stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
        finally:os.close(log)
        protected(self.run/'guard-process.json',{'pid':p.pid,'ticks':tick(p.pid)})
        for _ in range(100):
            if (self.run/'guard-ready.json').exists():return {'deadline':deadline,'independent':True,'parent_loss':True}
            time.sleep(.05)
        raise scope.ScopeError('Independent guard did not acknowledge')
    def broker_command(self,phase):return [self.node,self.broker,phase,self.run,self.repo]
    def journal(self,reservation,event):
        if reservation!=str(self.run):raise scope.ScopeError('Wrong journal target')
        c=self.read();c['phases'].append(event);protected(self.run/'control.json',c)
    def snapshot(self):
        data=self.command(['git','archive','--format=tar',self.head]);dest=self.run/'app-source';dest.mkdir(mode=0o700)
        with tarfile.open(fileobj=io.BytesIO(data)) as archive:
            for m in archive.getmembers():
                target=dest/m.name
                if m.issym() or m.islnk() or not target.resolve().is_relative_to(dest) or (Path(m.name).name.startswith('.env') and not m.name.endswith('.example')):raise scope.ScopeError('Unsafe or credential-bearing archive entry')
            archive.extractall(dest,filter='data')
        for name in ['node_modules','apps/web/node_modules','packages/db/node_modules','packages/domain/node_modules']:
            if (self.repo/name).exists():(dest/name).symlink_to(self.repo/name,target_is_directory=True)
    def guard_identity(self):
        guard=json.loads((self.run/'guard-process.json').read_text())
        if tick(guard['pid'])!=guard['ticks'] or Path('/proc',str(guard['pid'])).stat().st_uid!=os.getuid():raise scope.ScopeError('Independent guard is not alive')
        if time.monotonic()>=self.read().get('monotonic_deadline',float('inf'))-180:raise scope.ScopeError('Monotonic window cutoff')
    def phase(self,name,reservation,plan,deadline):
        if reservation!=str(self.run) or plan!=self.plan or self.now()>=deadline-180:raise scope.ScopeError('Window closed; reserve cleanup time, never renew')
        if self.command(['git','rev-parse','HEAD']).decode().strip()!=self.read()['head']:raise scope.ScopeError('Source changed during lease; cleanup before any new work')
        self.guard_identity()
        self.journal(reservation,{'starting':name})
        self.env['CHECKPOINT_REHEARSAL_CONTROL']=str(self.run)
        if name=='stage':
            self.command(self.broker_command('stage'));raw=self.command(self.compose('config','--format','json'));protected(self.run/'effective-compose.private.json',json.loads(raw));validate_effective(json.loads(raw),plan);self.snapshot()
        elif name=='start':
            self.command(self.compose('up','-d','--pull','never','--no-build','--wait','--wait-timeout','180',*plan.services),timeout=240)
            ids=self.command(['docker','ps','-aq','--no-trunc','--filter','label=com.docker.compose.project='+plan.project]).decode().splitlines()
            if len(ids)!=8 or len(set(ids))!=8 or any(x in self.read()['baseline_containers'] for x in ids):raise scope.ScopeError('Unexpected new container identities')
            protected(self.run/'containers.json',ids)
        elif name=='apply_scoped_sql':self.command(self.broker_command(name),timeout=180)
        elif name=='issue_restricted_access':
            self.command(self.broker_command(name),timeout=120);self.start_app()
        elif name=='assert_http_and_browser':
            # Browser work uses the supported existing extension/manual owner, not a
            # headless route, CDP launch or automatic retry of denied navigation.
            while not (self.run/'browser-evidence.json').exists():
                if self.now()>=deadline-180:raise scope.ScopeError('Browser receipt pending; stop without extension')
                time.sleep(.5)
            self.command(self.broker_command('validate_browser'))
            self.command(self.broker_command('assert_http'),timeout=120)
        else:raise scope.ScopeError('Unknown phase')
    def start_app(self):
        # The source snapshot excludes .env and uses existing local dependencies.
        env=json.loads(self.command(self.broker_command('app_environment')))
        env['CHECKPOINT_REHEARSAL_CONTROL']=str(self.run)
        source=self.run/'app-source'
        self.commands.run(['pnpm','build'],cwd=source,env=env,timeout=240)
        log=os.open(self.run/'app.private.log',os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        try:p=subprocess.Popen([sys.executable,'-c',GATE,self.node,str(source/'apps/web/node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port','3151'],cwd=source/'apps/web',env=env,stdin=subprocess.PIPE,stdout=log,stderr=log,start_new_session=True)
        finally:os.close(log)
        try:
            protected(self.run/'app-process.json',{'pid':p.pid,'ticks':tick(p.pid),'cwd':str(source/'apps/web'),'exe':self.node,'launcher_exe':sys.executable})
            p.stdin.write(b'1');p.stdin.flush();p.stdin.close()
        except Exception:
            p.stdin.close();p.wait(timeout=5);raise
        import urllib.request
        for _ in range(80):
            try:
                with urllib.request.urlopen('http://127.0.0.1:3151/api/health',timeout=2) as response:
                    if response.status==200:break
            except OSError:pass
            if self.now()>=self.read()['deadline']-180:raise scope.ScopeError('No app readiness before cleanup cutoff')
            time.sleep(.5)
        else:raise scope.ScopeError('App readiness failed')
        # Do not expose fixture credentials in stdout. URLs and required browser
        # assertions are saved privately for the approved test operator.
        protected(self.run/'browser-ready.json',{'origin':'http://127.0.0.1:3151','context':str(self.run/'fixture.json'),'receipt':str(self.run/'browser-evidence.json')})
    def revoke_and_stop(self,reservation,plan,retain=True):
        if reservation!=str(self.run) or plan!=self.plan or not retain:raise scope.ScopeError('Wrong cleanup target')
        fd=os.open(self.run/'cleanup.lock',os.O_WRONLY|os.O_CREAT,0o600)
        try:
            limit=time.monotonic()+30
            while True:
                try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);break
                except BlockingIOError:
                    if time.monotonic()>=limit:raise scope.ScopeError('Cleanup already active; inspect receipt')
                    time.sleep(.1)
            if not (self.run/'cleanup.json').exists():self._revoke_and_stop(plan)
        finally:os.close(fd)
    def _revoke_and_stop(self,plan):
        c=self.read();access=True
        protected(self.run/'revoking.json',{'started_at':self.now()})
        phase_file=self.run/'phase-process.json'
        if phase_file.exists():
            phase=json.loads(phase_file.read_text());proc=Path('/proc',str(phase['pid']))
            if not phase['finished'] and proc.exists():
                fd=os.pidfd_open(phase['pid'])
                try:
                    if tick(phase['pid'])!=phase['ticks'] or proc.stat().st_uid!=os.getuid() or os.getpgid(phase['pid'])!=phase['pid']:raise scope.ScopeError('Phase identity mismatch')
                    os.killpg(phase['pid'],signal.SIGTERM);poll=select.poll();poll.register(fd,select.POLLIN)
                    if not poll.poll(15000):raise scope.ScopeError('Phase still active; access revocation unsafe')
                finally:os.close(fd)
        # No process enumeration: the launch gate prevents unregistered sensitive work.
        # Cleanup commands are not a new work phase and must not overwrite the
        # process identity that an independent guard may be stopping.
        self.env.pop('CHECKPOINT_REHEARSAL_CONTROL',None)
        try:
            if any(isinstance(x,dict) and x.get('starting')=='issue_restricted_access' for x in c['phases']):self.command(self.broker_command('disable'),timeout=60)
        except Exception:
            access=False
            try:self.command(self.broker_command('disable_sql_access'),timeout=30)
            except Exception:pass  # Keep cleanup unverified; still stop only owned endpoints.
        p=self.run/'app-process.json';apps=[]
        if p.exists():apps=[json.loads(p.read_text())]
        # Without an app identity receipt, its gate never received GO.
        for obj in apps:
            proc=Path('/proc',str(obj['pid']))
            if proc.exists():
                fd=os.pidfd_open(obj['pid'])
                try:
                    if tick(obj['pid'])!=obj['ticks'] or proc.stat().st_uid!=os.getuid() or (proc/'cwd').resolve()!=Path(obj['cwd']) or (proc/'exe').resolve() not in {Path(obj['exe']).resolve(),Path(obj.get('launcher_exe',obj['exe'])).resolve()}:raise scope.ScopeError('App identity mismatch')
                    signal.pidfd_send_signal(fd,signal.SIGTERM);poll=select.poll();poll.register(fd,select.POLLIN)
                    if not poll.poll(15000):raise scope.ScopeError('App did not exit')
                finally:os.close(fd)
        ids=self.command(['docker','ps','-aq','--no-trunc','--filter','label=com.docker.compose.project='+plan.project]).decode().splitlines()
        for cid in ids:
            if cid in c['baseline_containers']:raise scope.ScopeError('Retained container overlap; no stop')
            container=json.loads(self.command(['docker','inspect',cid]))[0];labels=container['Config']['Labels']
            if labels.get('com.docker.compose.project')!=plan.project or labels.get('com.docker.compose.service') not in plan.services or Path(labels.get('com.docker.compose.project.working_dir','')).resolve()!=self.run/'stack':raise scope.ScopeError('Container ownership mismatch; no stop')
            if container['State']['Running']:self.command(['docker','stop','--time','10',cid],timeout=30)
        protected(self.run/'cleanup.json',{'access_disabled':access,'retained':True,'no_permanent_deletion':True,'stopped_at':self.now()})
        if not access:raise scope.ScopeError('Access revocation unverified; inspect retained evidence')
    def verify_stopped(self,reservation,plan):
        if reservation!=str(self.run) or plan!=self.plan:return False
        if self.command(['docker','ps','-q','--filter','label=com.docker.compose.project='+plan.project]).strip():return False
        for _,host,port in plan.bindings:
            with socket.socket() as s:s.settimeout(1);busy=s.connect_ex((host,port))==0
            if busy:return False
        guard_file=self.run/'guard-process.json'
        if guard_file.exists():
            guard=json.loads(guard_file.read_text())
            if guard['pid']!=os.getpid():
                try:
                    if tick(guard['pid'])==guard['ticks']:
                        fd=os.pidfd_open(guard['pid'])
                        try:
                            poll=select.poll();poll.register(fd,select.POLLIN)
                            if not poll.poll(3000):return False
                        finally:os.close(fd)
                except OSError:pass
        return json.loads((self.run/'cleanup.json').read_text())['access_disabled'] is True


def main():
    parser=argparse.ArgumentParser();mode=parser.add_mutually_exclusive_group();mode.add_argument('--plan',action='store_true');mode.add_argument('--execute',action='store_true');mode.add_argument('--watch',action='store_true');mode.add_argument('--cleanup',action='store_true');parser.add_argument('--approval-file');parser.add_argument('--browser-context');parser.add_argument('--template');args=parser.parse_args()
    repo=Path(__file__).resolve().parents[1]
    if not (args.execute or args.watch or args.cleanup):print(json.dumps({**scope.proposal(),'scope_sha256':scope.scope_digest()},indent=2));return
    if args.watch or args.cleanup:
        run=Path(scope.Plan().directory);c=json.loads((run/'control.json').read_text());adapter=LiveAdapter(c['repo'],c['template'],{})
        adapter.read()
        if args.watch:
            protected(run/'guard-ready.json',{'pid':os.getpid(),'deadline':c['deadline'],'parent_loss':True})
            while not (run/'cleanup.json').exists():
                if guard_should_stop(c,time.time()):break
                time.sleep(.5)
            if (run/'cleanup.json').exists():return
        adapter.revoke_and_stop(str(run),adapter.plan)
        return
    if not (args.approval_file and args.browser_context and args.template):parser.error('Explicit fresh approval, browser context and pinned template are required.')
    approval_path=Path(args.approval_file)
    if approval_path.is_symlink() or approval_path.stat().st_uid!=os.getuid() or stat.S_IMODE(approval_path.stat().st_mode)!=0o600:raise scope.ScopeError('Approval receipt must be private and owned')
    approval=json.loads(approval_path.read_text())
    if approval.get('browser_origin')!='http://127.0.0.1:3151':raise scope.ScopeError('New authenticated origin must be explicitly approved')
    adapter=LiveAdapter(repo,args.template,json.loads(Path(args.browser_context).read_text()))
    outcome=scope.exercise_injected(adapter,approval,time.time);protected(adapter.run/'outcome.json',outcome)
    print(json.dumps(outcome))


if __name__=='__main__':
    try:main()
    except Exception:sys.stderr.write('REHEARSAL_STOPPED: inspect protected control/evidence; no automatic retry or renewal.\n');sys.exit(1)
