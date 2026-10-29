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
import math
import re
import shlex
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


def validate_effective(c,plan,expected_images):
    if set(expected_images)!=set(plan.services):raise scope.ScopeError('Exact pinned image map required')
    if c.get('name')!=plan.project or set(c.get('services',{}))!=set(plan.services):raise scope.ScopeError('Wrong effective project/services')
    for name,s in c['services'].items():
        if s.get('container_name')!=plan.project+'-'+name or s.get('restart')!='no' or s.get('privileged') or s.get('network_mode'):raise scope.ScopeError('Unsafe service isolation')
        if not re.fullmatch(r'.+@sha256:[0-9a-f]{64}',s.get('image','')) or s['image']!=expected_images[name]:raise scope.ScopeError('Image must equal its exact pinned source lock')
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


UNRELATED_DIRTY_ALLOWLIST=frozenset({
    'apps/web/public/ASSETS.md',
    'apps/web/components/learning/home-next-action.module.css',
    'apps/web/public/piscine/official-logo.svg',
    'docs/RELEASE_CANDIDATE_001_REPORT.md',
})


BUILD_SPECS=(
    ('packages/domain','@nextera/domain',('tsc','-p','tsconfig.json'),'node_modules/typescript/bin/tsc'),
    ('packages/db','@nextera/db',('tsc','-p','tsconfig.json'),'node_modules/typescript/bin/tsc'),
    ('apps/web','@nextera/web',('next','build'),'apps/web/node_modules/next/dist/bin/next'),
)


def validate_build_scripts(manifests):
    expected=[]
    for _,name,_,_ in BUILD_SPECS:
        if expected:expected.append('&&')
        expected.extend(['pnpm','--filter',name,'build'])
    try:
        if shlex.split(manifests['package.json']['scripts']['build'])!=expected:raise scope.ScopeError('Unrecognized root build pipeline; review before provisioning')
        if any(name in manifests['package.json']['scripts'] for name in ['prebuild','postbuild']):raise scope.ScopeError('Unreviewed root build lifecycle hook')
        for folder,name,tokens,_ in BUILD_SPECS:
            package=manifests[folder+'/package.json']
            if package['name']!=name or shlex.split(package['scripts']['build'])!=list(tokens) or any(k in package['scripts'] for k in ['prebuild','postbuild']):raise scope.ScopeError('Unrecognized declared package build script')
    except (KeyError,ValueError,TypeError) as error:
        if isinstance(error,scope.ScopeError):raise
        raise scope.ScopeError('Invalid public build manifest') from error
    return BUILD_SPECS


def direct_build_plan(repo,source=None,node=None):
    """Read only public manifests/installed CLI metadata; no package manager or .env."""
    repo=Path(repo);source=Path(source) if source is not None else repo
    manifests={name:json.loads((source/name).read_text()) for name in ['package.json',*[folder+'/package.json' for folder,_,_,_ in BUILD_SPECS]]}
    validate_build_scripts(manifests)
    expected_node=repo/'.tools/node-v24.19.0-linux-x64/bin/node'
    if manifests['package.json'].get('engines',{}).get('node')!='24.19.0' or (node is not None and Path(node)!=expected_node):raise scope.ScopeError('Unreviewed Node runtime')
    if not expected_node.is_file() or not os.access(expected_node,os.X_OK):raise scope.ScopeError('Installed Node binary required; no auto-install')
    installed=[('node_modules/typescript/package.json',manifests['package.json']['devDependencies']['typescript']),('apps/web/node_modules/next/package.json',manifests['apps/web/package.json']['dependencies']['next'])]
    for name,wanted in installed:
        if json.loads((repo/name).read_text()).get('version')!=wanted:raise scope.ScopeError('Installed compiler version differs from public manifest')
    for metadata in ['node_modules/@types/node/package.json','apps/web/node_modules/@types/react/package.json']:
        if not (repo/metadata).is_file():raise scope.ScopeError('Installed Next type dependencies required; no auto-install')
    plan=[]
    for folder,name,tokens,binary in BUILD_SPECS:
        cli=repo/binary
        if not cli.is_file() or not cli.resolve().is_relative_to((repo/'node_modules').resolve()):raise scope.ScopeError('Installed compiler CLI missing or outside reviewed dependencies')
        plan.append({'package':name,'cwd':str(source/folder),'argv':[str(expected_node),str(cli),*tokens[1:]]})
    return plan


def validate_build_source_environment(source):
    # Metadata only: do not open environment files. Private archive extraction has
    # already rejected secret-bearing entries throughout the source tree.
    for folder in [Path(source),Path(source)/'apps/web']:
        if any(not p.name.endswith('.example') for p in folder.glob('.env*')):raise scope.ScopeError('Private build source contains an environment file; do not read/build it')


def link_snapshot_dependencies(repo,destination):
    """Reuse installed vendor code without pointing workspace aliases at mutable source.

    Creates only absent snapshot-local link directories. Never removes or modifies
    any original dependency entry, package-manager state or existing destination.
    """
    repo=Path(repo);destination=Path(destination)
    if not destination.is_dir() or destination.is_symlink() or destination.resolve()==repo.resolve() or destination.resolve().is_relative_to((repo/'node_modules').resolve()):raise scope.ScopeError('A separate existing private source snapshot is required')
    targets={'domain':destination/'packages/domain','db':destination/'packages/db'}
    if any(not p.is_dir() or p.is_symlink() for p in targets.values()):raise scope.ScopeError('Snapshot workspace packages missing')
    for name in ['node_modules','apps/web/node_modules','packages/db/node_modules','packages/domain/node_modules']:
        original=repo/name
        if not original.is_dir():continue
        target=destination/name
        if target.exists() or target.is_symlink():raise scope.ScopeError('Snapshot dependency destination already exists; never replace it')
        target.mkdir(mode=0o700)
        for entry in original.iterdir():
            if entry.name in {'.modules.yaml','.pnpm-workspace-state-v1.json','.package-lock.json'}:continue
            if entry.name=='@nextera':
                if not entry.is_dir() or any(p.name not in targets for p in entry.iterdir()):raise scope.ScopeError('Unreviewed workspace alias')
                continue
            (target/entry.name).symlink_to(entry,target_is_directory=entry.is_dir())
        namespace=target/'@nextera';namespace.mkdir(mode=0o700)
        for alias,package in targets.items():(namespace/alias).symlink_to(package,target_is_directory=True)


def verify_sql_sources(repo,locked_sql):
    """Source/hash inspection only. Never connect or execute SQL during preflight."""
    repo=Path(repo);folder=repo/'packages/db/migrations';registered=sorted(folder.glob('*.sql'))
    prefixes=[p.name.split('_',1)[0] for p in registered]
    if len(registered)!=11 or set(prefixes)!={f'{i:04d}' for i in range(11)} or any(not re.fullmatch(r'\d{4}_.+\.sql',p.name) for p in registered):
        raise scope.ScopeError('Exact registered SQL0000-0010 prerequisites required')
    files=[*registered,repo/'packages/db/migration-drafts/0011_checkpoint_drafts.DRAFT.sql',repo/'packages/db/migration-drafts/0014_checkpoint_editor_context.DRAFT.sql']
    expected={str(p.relative_to(repo)):p for p in files}
    if not isinstance(locked_sql,dict) or set(locked_sql)!=set(expected):raise scope.ScopeError('Exact SQL source lock set required; no missing/extra migrations')
    for name,p in expected.items():
        if not p.is_file() or p.is_symlink() or not p.resolve().is_relative_to(repo.resolve()):raise scope.ScopeError('Missing or unsafe SQL source prerequisite')
        if hashlib.sha256(p.read_bytes()).hexdigest()!=locked_sql[name]:raise scope.ScopeError('SQL source digest mismatch before provisioning')
    return dict(locked_sql)


def runtime_source_changes(paths):
    """Git path metadata only; never read environment/configuration secret contents."""
    changed=[]
    for name in paths:
        if name in UNRELATED_DIRTY_ALLOWLIST:continue
        p=Path(name)
        if p.is_absolute() or '..' in p.parts:raise scope.ScopeError('Invalid Git source path metadata')
        runtime=p.parts and p.parts[0] in {'apps','packages','scripts','infra','tests'}
        root_config=len(p.parts)==1 and (p.suffix in {'.json','.yaml','.yml','.js','.mjs','.cjs','.ts','.mts','.cts','.toml','.lock'} or p.name.startswith('.env') or p.name in {'Dockerfile','Makefile','.npmrc','.nvmrc','.gitignore','.prettierignore','.prettierrc','.eslintignore','.eslintrc','.babelrc','.browserslistrc','.swcrc','.editorconfig'})
        if runtime or root_config:changed.append(name)
    return changed


COMMAND_TERM_GRACE_SECONDS=0.5
COMMAND_KILL_GRACE_SECONDS=0.5
COMMAND_TERMINATION_RESERVE=COMMAND_TERM_GRACE_SECONDS+COMMAND_KILL_GRACE_SECONDS
CLEANUP_STOP_RESERVE_SECONDS=45.0
CLEANUP_LATE_STOP_SECONDS=20.0
OWNERSHIP_FORMAT='[{{json .Id}},{{json .State.Running}},{{json (index .Config.Labels "com.docker.compose.project")}},{{json (index .Config.Labels "com.docker.compose.service")}},{{json (index .Config.Labels "com.docker.compose.project.working_dir")}}]'


class CleanupBudget:
    """Use both original deadlines; a late stop is best effort, never lease renewal."""
    def __init__(self,control,now,monotonic):
        self.now=now;self.monotonic=monotonic
        self.wall=control.get('deadline');self.mono=control.get('monotonic_deadline')
        self.valid=(type(self.wall) in (int,float) and type(self.mono) in (int,float) and math.isfinite(self.wall) and math.isfinite(self.mono))
        self.emergency_end=None
        if not self.valid or self.original_remaining()<=0:self.begin_stop_only()
    def original_remaining(self):
        return min(self.wall-self.now(),self.mono-self.monotonic()) if self.valid else float('-inf')
    def remaining(self):
        if self.emergency_end is not None:return max(0.0,self.emergency_end-self.monotonic())
        return max(0.0,self.original_remaining())
    def begin_stop_only(self):
        if self.emergency_end is None and (not self.valid or self.original_remaining()<CLEANUP_STOP_RESERVE_SECONDS):
            self.emergency_end=self.monotonic()+CLEANUP_LATE_STOP_SECONDS
    def timeout(self,cap,reserve=0.0):
        seconds=min(float(cap),self.remaining()-reserve-COMMAND_TERMINATION_RESERVE)
        if seconds<=0:raise scope.ScopeError('Cleanup budget exhausted; shutdown remains unverified')
        return seconds
    def provider_allowed(self):
        return self.valid and self.emergency_end is None and self.original_remaining()>CLEANUP_STOP_RESERVE_SECONDS+COMMAND_TERMINATION_RESERVE and self.now()<self.wall-30
    def met_original_deadline(self):
        return self.valid and self.original_remaining()>=0


class Commands:
    def _signal_owned_group(self,p,record,signum):
        if p.poll() is not None:return
        try:
            if tick(p.pid)!=record['ticks'] or os.getpgid(p.pid)!=p.pid:raise scope.ScopeError('Command process identity mismatch')
            os.killpg(p.pid,signum)
        except ProcessLookupError:
            if p.poll() is None:raise scope.ScopeError('Command identity disappeared; termination unverified')
    def _terminate_bounded(self,p,record):
        self._signal_owned_group(p,record,signal.SIGTERM)
        try:p.communicate(timeout=COMMAND_TERM_GRACE_SECONDS)
        except subprocess.TimeoutExpired:
            self._signal_owned_group(p,record,signal.SIGKILL)
            try:p.communicate(timeout=COMMAND_KILL_GRACE_SECONDS)
            except subprocess.TimeoutExpired:raise scope.ScopeError('Command termination unverified after bounded grace')
    def run(self,args,*,env,cwd,input=None,timeout=60):
        control=env.get('CHECKPOINT_REHEARSAL_CONTROL')
        launch=[sys.executable,'-c',GATE,*args]
        p=subprocess.Popen(launch,env=env,cwd=cwd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
        record={'pid':p.pid,'ticks':tick(p.pid),'cwd':str(Path(cwd).resolve()),'uid':os.getuid(),'finished':False}
        if control:
            try:protected(Path(control)/'phase-process.json',record)
            except Exception:
                p.communicate(input=b'',timeout=COMMAND_TERM_GRACE_SECONDS)  # EOF without GO: sensitive target never executes.
                raise
        try:
            stdout,stderr=p.communicate(input=b'1'+(input or b''),timeout=timeout)
        except subprocess.TimeoutExpired:
            self._terminate_bounded(p,record)
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
    def __init__(self,repo,template,browser,commands=None,now=time.time,profile='attempt001',monotonic=time.monotonic):
        self.repo=Path(repo).resolve();self.template=Path(template).resolve();self.browser=browser;self.commands=commands or Commands();self.now=now;self.monotonic=monotonic
        self.profile=profile;self.plan=scope.plan_for(profile);self.run=Path(self.plan.directory)
        self.env={'PATH':str(self.repo/'.tools/node-v24.19.0-linux-x64/bin')+':/mnt/c/Users/lap/AppData/Roaming/npm:/usr/bin:/bin','HOME':str(Path.home()),'LANG':'C.UTF-8','NEXT_TELEMETRY_DISABLED':'1'}
        self.env['DOCKER_CONFIG']=str(self.run/'docker-client')
        self.env['CHECKPOINT_REHEARSAL_PROFILE']=self.profile
        self.node=str(self.repo/'.tools/node-v24.19.0-linux-x64/bin/node')
        self.broker=str(self.run/'adapter-code/checkpoint-auth-runtime.mjs')
    def command(self,args,timeout=60,input=None):return self.commands.run([str(a) for a in args],env=self.env,cwd=self.repo,input=input,timeout=timeout)
    def compose(self,*args):return ['docker','compose','--project-name',self.plan.project,'--project-directory',self.run/'stack','--env-file',self.run/'stack/.env','-f',self.run/'stack/docker-compose.yml',*args]
    def verify_source_hygiene(self):
        tracked=self.command(['git','diff','--name-only','-z','HEAD']).decode().split('\0')
        untracked=self.command(['git','ls-files','--others','--exclude-standard','-z']).decode().split('\0')
        if runtime_source_changes([p for p in tracked+untracked if p]):raise scope.ScopeError('Uncommitted runtime source; commit/review before owner approval')
        # The operator must separately pin the reviewed HEAD from trusted context.
        # A clean worktree alone cannot authenticate user/parent review history.
    def preflight(self,plan):
        self.verify_source_hygiene()
        if plan!=self.plan or self.run.exists():raise scope.ScopeError('Fresh target required; inspect uncertain state, do not reuse.')
        if not browser_context(self.browser,self.now()):raise scope.ScopeError('Fresh supported browser context receipt required.')
        self.source_lock_bytes=(self.repo/'infra/checkpoint-auth-rehearsal/source-lock.json').read_bytes()
        self.source_lock_sha256=hashlib.sha256(self.source_lock_bytes).hexdigest()
        lock=json.loads(self.source_lock_bytes)
        if lock['commit']!=plan.upstream_commit or set(lock['images'])!=set(plan.services):raise scope.ScopeError('Wrong source lock')
        for name,digest in lock['files'].items():
            p=self.template/name
            if p.is_symlink() or not p.resolve().is_relative_to(self.template) or hashlib.sha256(p.read_bytes()).hexdigest()!=digest:raise scope.ScopeError('Template identity mismatch')
        self.sql_source_sha256=verify_sql_sources(self.repo,lock.get('sql'))
        self.preflight_build_plan=direct_build_plan(self.repo,node=self.node)
        for image in lock['images'].values():self.command(['docker','image','inspect',image])
        if self.command(['docker','ps','-aq','--no-trunc','--filter','label=com.docker.compose.project='+plan.project]).strip():raise scope.ScopeError('Project already exists')
        volumes=self.command(['docker','volume','ls','-q']).decode().splitlines()
        if any(v.startswith(plan.project+'-') for v in volumes):raise scope.ScopeError('Run volumes already exist')
        if self.command(['docker','network','ls','-q','--filter','label=com.docker.compose.project='+plan.project]).strip():raise scope.ScopeError('Run network already exists')
        for _,host,port in plan.bindings:
            with socket.socket() as s:s.settimeout(1);busy=s.connect_ex((host,port))==0
            if busy:raise scope.ScopeError('Proposed port busy')
        self.head=self.command(['git','rev-parse','HEAD']).decode().strip()
        return {**{k:True for k in ['fresh_directory','fresh_project','fresh_volumes','ports_available','pinned_images_available','template_digest_verified','browser_target_permitted','cleanup_supported']},'database':plan.database,'project':plan.project,'migrations':list(plan.migrations),'bindings':[list(x) for x in plan.bindings],'role_memberships':list(plan.role_memberships),'services':list(plan.services),'source_lock_sha256':self.source_lock_sha256,'sql_source_sha256':self.sql_source_sha256,'direct_build_plan':self.preflight_build_plan}
    def reserve_fresh(self,plan,outcome):
        if not hasattr(self,'source_lock_bytes') or hashlib.sha256(self.source_lock_bytes).hexdigest()!=self.source_lock_sha256:raise scope.ScopeError('Verified public source lock required before reservation')
        # Existing ancestors may exist; none may resolve through a symlink.
        for p in [self.run,*self.run.parents]:
            if p.is_symlink():raise scope.ScopeError('Symlink in private run path')
        self.run.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        self.run.mkdir(mode=0o700);os.chmod(self.run,0o700)
        (self.run/'docker-client').mkdir(mode=0o700)
        control={**outcome,'project':plan.project,'database':plan.database,'uid':os.getuid(),'parent_pid':os.getpid(),'parent_ticks':tick(os.getpid()),'template':str(self.template),'repo':str(self.repo),'head':self.head,'phases':[],'monotonic_deadline':self.monotonic()+plan.maximum_seconds,'profile':self.profile,'source_lock_sha256':self.source_lock_sha256,'baseline_containers':self.command(['docker','ps','-aq','--no-trunc']).decode().splitlines()}
        code=self.run/'adapter-code';code.mkdir(mode=0o700)
        for name in ['checkpoint-auth-live-adapter.py','checkpoint-auth-rehearsal.py','checkpoint-auth-runtime.mjs','checkpoint-auth-profiles.json']:
            data=(self.repo/'scripts'/name).read_bytes();target=code/name
            fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
            with os.fdopen(fd,'wb') as f:f.write(data);f.flush();os.fsync(f.fileno())
        target=code/'checkpoint-auth-source-lock.json'
        fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,'wb') as f:f.write(self.source_lock_bytes);f.flush();os.fsync(f.fileno())
        self.broker=str(code/'checkpoint-auth-runtime.mjs')
        protected(self.run/'control.json',control);return str(self.run)
    def read(self):
        if self.run!=Path(self.plan.directory) or self.run.is_symlink() or self.run.stat().st_uid!=os.getuid() or stat.S_IMODE(self.run.stat().st_mode)!=0o700:raise scope.ScopeError('Unrecognized private lease')
        c=json.loads((self.run/'control.json').read_text())
        if c['project']!=self.plan.project or c['database']!=self.plan.database or c['uid']!=os.getuid() or c['scope_sha256']!=scope.scope_digest(self.plan) or c.get('profile','attempt001')!=self.profile:raise scope.ScopeError('Lease mismatch')
        return c
    def pinned_images(self):
        # A corrupted/missing lock fails privileged stage validation. Ownership-only
        # shutdown does not depend on reading a subsequently edited repository lock.
        c=self.read();data=(self.run/'adapter-code/checkpoint-auth-source-lock.json').read_bytes()
        if hashlib.sha256(data).hexdigest()!=c.get('source_lock_sha256'):raise scope.ScopeError('Immutable public source lock mismatch')
        lock=json.loads(data)
        if lock.get('commit')!=self.plan.upstream_commit or set(lock.get('images',{}))!=set(self.plan.services):raise scope.ScopeError('Wrong immutable image lock')
        return lock['images']
    def arm_guard(self,reservation,deadline,**kwargs):
        if reservation!=str(self.run) or kwargs!={'parent_loss':True,'retain':True}:raise scope.ScopeError('Wrong guard request')
        log=os.open(self.run/'guard.private.log',os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        try:p=subprocess.Popen([sys.executable,str(self.run/'adapter-code/checkpoint-auth-live-adapter.py'),'--watch','--profile',self.profile],env=self.env,cwd=self.repo,stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
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
        os.chmod(dest,0o700)
        link_snapshot_dependencies(self.repo,dest)
    def guard_identity(self):
        guard=json.loads((self.run/'guard-process.json').read_text())
        if tick(guard['pid'])!=guard['ticks'] or Path('/proc',str(guard['pid'])).stat().st_uid!=os.getuid():raise scope.ScopeError('Independent guard is not alive')
        if self.monotonic()>=self.read().get('monotonic_deadline',float('inf'))-180:raise scope.ScopeError('Monotonic window cutoff')
    def phase(self,name,reservation,plan,deadline):
        if reservation!=str(self.run) or plan!=self.plan or self.now()>=deadline-180:raise scope.ScopeError('Window closed; reserve cleanup time, never renew')
        if self.command(['git','rev-parse','HEAD']).decode().strip()!=self.read()['head']:raise scope.ScopeError('Source changed during lease; cleanup before any new work')
        self.guard_identity()
        self.journal(reservation,{'starting':name})
        self.env['CHECKPOINT_REHEARSAL_CONTROL']=str(self.run)
        if name=='stage':
            self.command(self.broker_command('stage'));raw=self.command(self.compose('config','--format','json'));protected(self.run/'effective-compose.private.json',json.loads(raw));validate_effective(json.loads(raw),plan,self.pinned_images());self.snapshot()
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
    def build_snapshot(self,source,env):
        validate_build_source_environment(source)
        plan=direct_build_plan(self.repo,source,self.node)
        # Noninteractive compilation must fail on missing dependencies, not invite
        # a package-manager install. This adds no service/admin environment access.
        build_env={**env,'CI':'1','NEXT_TELEMETRY_DISABLED':'1'}
        for step in plan:
            c=self.read();self.guard_identity()
            remaining=min(c['deadline']-180-self.now(),c['monotonic_deadline']-180-self.monotonic())-COMMAND_TERMINATION_RESERVE
            if remaining<=0:raise scope.ScopeError('No build time before original cleanup cutoff')
            self.commands.run(step['argv'],cwd=Path(step['cwd']),env=build_env,timeout=min(240,remaining))
        return plan
    def start_app(self):
        # The source snapshot excludes .env and uses existing local dependencies.
        env=json.loads(self.command(self.broker_command('app_environment')))
        env['CHECKPOINT_REHEARSAL_CONTROL']=str(self.run)
        source=self.run/'app-source'
        build_plan=self.build_snapshot(source,env)
        next_cli=build_plan[-1]['argv'][1]
        log=os.open(self.run/'app.private.log',os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        try:p=subprocess.Popen([sys.executable,'-c',GATE,self.node,next_cli,'start','--hostname','127.0.0.1','--port','3151'],cwd=source/'apps/web',env=env,stdin=subprocess.PIPE,stdout=log,stderr=log,start_new_session=True)
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
        budget=CleanupBudget(self.read(),self.now,self.monotonic)
        fd=os.open(self.run/'cleanup.lock',os.O_WRONLY|os.O_CREAT,0o600)
        try:
            lock_end=self.monotonic()+min(5.0,max(0.0,budget.remaining()-15.0))
            while True:
                try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);break
                except BlockingIOError:
                    if self.monotonic()>=lock_end or budget.remaining()<=0:raise scope.ScopeError('Cleanup already active; inspect receipt')
                    time.sleep(min(.05,max(0.0,lock_end-self.monotonic())))
            if not (self.run/'cleanup.json').exists():self._revoke_and_stop(plan,budget)
        finally:os.close(fd)
    def _stop_recorded_process(self,obj,budget,*,phase=False):
        proc=Path('/proc',str(obj['pid']))
        if not proc.exists():return
        fd=os.pidfd_open(obj['pid'])
        try:
            if tick(obj['pid'])!=obj['ticks'] or proc.stat().st_uid!=os.getuid():raise scope.ScopeError('Process identity mismatch')
            if phase:
                if os.getpgid(obj['pid'])!=obj['pid']:raise scope.ScopeError('Phase group mismatch')
                os.killpg(obj['pid'],signal.SIGTERM)
            else:
                if (proc/'cwd').resolve()!=Path(obj['cwd']) or (proc/'exe').resolve() not in {Path(obj['exe']).resolve(),Path(obj.get('launcher_exe',obj['exe'])).resolve()}:raise scope.ScopeError('App identity mismatch')
                signal.pidfd_send_signal(fd,signal.SIGTERM)
            poll=select.poll();poll.register(fd,select.POLLIN)
            wait=min(.5 if budget.emergency_end is not None else 3.0,max(0.0,budget.remaining()-2.0))
            if poll.poll(int(wait*1000)):return
            # Recheck identity before escalation; never signal a reused/unowned PID.
            if tick(obj['pid'])!=obj['ticks']:raise scope.ScopeError('Process identity changed during stop')
            if phase:
                if os.getpgid(obj['pid'])!=obj['pid']:raise scope.ScopeError('Phase group changed during stop')
                os.killpg(obj['pid'],signal.SIGKILL)
            else:signal.pidfd_send_signal(fd,signal.SIGKILL)
            if not poll.poll(int(min(.5 if budget.emergency_end is not None else 1.0,budget.remaining())*1000)):raise scope.ScopeError('Recorded process stop unverified')
        finally:os.close(fd)
    def _revoke_and_stop(self,plan,budget=None):
        c=self.read();budget=budget or CleanupBudget(c,self.now,self.monotonic);access=True;errors=[]
        protected(self.run/'revoking.json',{'started_at':self.now()})
        phase_file=self.run/'phase-process.json'
        if phase_file.exists():
            phase=json.loads(phase_file.read_text())
            if not phase['finished']:
                try:self._stop_recorded_process(phase,budget,phase=True)
                except Exception:errors.append('phase_stop_unverified')
        # Separate cleanup commands do not overwrite the work-phase identity receipt.
        self.env.pop('CHECKPOINT_REHEARSAL_CONTROL',None)
        issued=any(isinstance(x,dict) and x.get('starting')=='issue_restricted_access' for x in c['phases'])
        if issued:
            access=False
            if 'phase_stop_unverified' not in errors and budget.provider_allowed():
                try:
                    self.command(self.broker_command('disable'),timeout=budget.timeout(40,CLEANUP_STOP_RESERVE_SECONDS));access=True
                except Exception:
                    errors.append('provider_revocation_unverified')
                    try:self.command(self.broker_command('disable_sql_access'),timeout=budget.timeout(15,CLEANUP_STOP_RESERVE_SECONDS))
                    except Exception:errors.append('sql_fallback_unverified')
            else:errors.append('revocation_skipped_for_stop_budget')
        budget.begin_stop_only()
        p=self.run/'app-process.json'
        if p.exists():
            try:self._stop_recorded_process(json.loads(p.read_text()),budget)
            except Exception:errors.append('app_stop_unverified')
        ids=[];verified=[]
        try:
            ids=self.command(['docker','ps','-aq','--no-trunc','--filter','label=com.docker.compose.project='+plan.project],timeout=budget.timeout(2 if budget.emergency_end is not None else 5)).decode().splitlines()
            if ids:
                rows=self.command(['docker','inspect','--format',OWNERSHIP_FORMAT,*ids],timeout=budget.timeout(2 if budget.emergency_end is not None else 5)).decode().splitlines()
                seen=set()
                for line in rows:
                    cid,running,project,service,directory=json.loads(line)
                    if cid in seen or cid not in ids or cid in c['baseline_containers'] or project!=plan.project or service not in plan.services or Path(directory).resolve()!=self.run/'stack':
                        errors.append('container_ownership_unverified');continue
                    seen.add(cid)
                    if running:verified.append(cid)
                if seen!=set(ids):errors.append('container_identity_missing')
        except Exception:errors.append('container_inspection_unverified')
        if verified:
            try:self.command(['docker','stop','--time','5',*verified],timeout=budget.timeout(8 if budget.emergency_end is not None else 12))
            except Exception:errors.append('container_stop_unverified')
        try:
            if self.command(['docker','ps','-q','--filter','label=com.docker.compose.project='+plan.project],timeout=budget.timeout(2 if budget.emergency_end is not None else 5)).strip():errors.append('containers_still_running')
        except Exception:errors.append('container_final_state_unverified')
        met=budget.met_original_deadline()
        if not met:errors.append('original_cleanup_deadline_missed')
        protected(self.run/'cleanup.json',{'access_disabled':access,'retained':True,'no_permanent_deletion':True,'stopped_at':self.now(),'original_deadline':c['deadline'],'original_deadline_met':met,'late_stop_only':budget.emergency_end is not None,'shutdown_verified':not errors,'errors':errors})
        if not access or errors:raise scope.ScopeError('Cleanup unverified; inspect retained evidence')
    def verify_stopped(self,reservation,plan):
        if reservation!=str(self.run) or plan!=self.plan:return False
        if self.command(['docker','ps','-q','--filter','label=com.docker.compose.project='+plan.project],timeout=5).strip():return False
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
        receipt=json.loads((self.run/'cleanup.json').read_text())
        return receipt['access_disabled'] is True and receipt.get('shutdown_verified',False) is True and receipt.get('original_deadline_met',False) is True


def main():
    parser=argparse.ArgumentParser();mode=parser.add_mutually_exclusive_group();mode.add_argument('--plan',action='store_true');mode.add_argument('--execute',action='store_true');mode.add_argument('--watch',action='store_true');mode.add_argument('--cleanup',action='store_true');parser.add_argument('--approval-file');parser.add_argument('--browser-context');parser.add_argument('--template');parser.add_argument('--profile',choices=['attempt001','attempt002','attempt003'],default='attempt001');parser.add_argument('--owner-message-id');parser.add_argument('--owner-approved-at');parser.add_argument('--owner-scope-sha256');args=parser.parse_args();plan=scope.plan_for(args.profile)
    repo=Path(__file__).resolve().parents[1]
    if not (args.execute or args.watch or args.cleanup):print(json.dumps({**scope.proposal(plan),'profile':args.profile,'scope_sha256':scope.scope_digest(plan)},indent=2));return
    if args.watch or args.cleanup:
        run=Path(plan.directory);c=json.loads((run/'control.json').read_text());adapter=LiveAdapter(c['repo'],c['template'],{},profile=args.profile)
        adapter.read()
        if args.watch:
            protected(run/'guard-ready.json',{'pid':os.getpid(),'deadline':c['deadline'],'parent_loss':True})
            while not (run/'cleanup.json').exists():
                if guard_should_stop(c,time.time()):break
                time.sleep(.5)
            if (run/'cleanup.json').exists():return
        adapter.revoke_and_stop(str(run),adapter.plan)
        return
    if not (args.approval_file and args.browser_context and args.template and args.owner_message_id and args.owner_approved_at and args.owner_scope_sha256):parser.error('Exact trusted owner message/time, matching receipt, browser context and pinned template are required.')
    owner_approval=scope.OwnerApproval(args.owner_message_id,args.owner_approved_at,args.owner_scope_sha256)
    approval_path=Path(args.approval_file)
    if approval_path.is_symlink() or approval_path.stat().st_uid!=os.getuid() or stat.S_IMODE(approval_path.stat().st_mode)!=0o600:raise scope.ScopeError('Approval receipt must be private and owned')
    approval=json.loads(approval_path.read_text())
    if approval.get('browser_origin')!='http://127.0.0.1:3151':raise scope.ScopeError('New authenticated origin must be explicitly approved')
    adapter=LiveAdapter(repo,args.template,json.loads(Path(args.browser_context).read_text()),profile=args.profile)
    outcome=scope.exercise_injected(adapter,approval,time.time,plan,owner_approval=owner_approval);protected(adapter.run/'outcome.json',outcome)
    print(json.dumps(outcome))


if __name__=='__main__':
    try:main()
    except Exception:sys.stderr.write('REHEARSAL_STOPPED: inspect protected control/evidence; no automatic retry or renewal.\n');sys.exit(1)
