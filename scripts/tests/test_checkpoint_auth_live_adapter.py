"""No real process/socket/provider is used. Only deterministic scope and command tests."""
from pathlib import Path
from unittest.mock import patch, Mock, MagicMock, call
import importlib.util
import sys
import json
import hashlib
import tempfile
import unittest
spec=importlib.util.spec_from_file_location('auth_live',Path(__file__).resolve().parents[1]/'checkpoint-auth-live-adapter.py')
h=importlib.util.module_from_spec(spec);sys.modules[spec.name]=h;spec.loader.exec_module(h)


class FakeCommands:
    def __init__(self):self.calls=[]
    def run(self,args,**kwargs):
        self.calls.append((args,kwargs))
        return b'expected-head\n' if args[:2]==['git','rev-parse'] else ('\n'.join('new-'+str(i) for i in range(8))+'\n').encode() if args[:3]==['docker','ps','-aq'] else b''


class AdapterTests(unittest.TestCase):
    def setUp(self):
        self.fake=FakeCommands();self.adapter=h.LiveAdapter('/repo','/public-template',{},self.fake,now=lambda:1000)
        self.adapter.journal=lambda *args:None
        self.adapter.read=lambda:{'head':'expected-head','baseline_containers':[]}
        self.adapter.guard_identity=lambda:None
        self.forbidden=[patch('subprocess.Popen',side_effect=AssertionError('No real processes')),patch('socket.socket',side_effect=AssertionError('No real sockets'))]
        for p in self.forbidden:p.start()
    def tearDown(self):
        for p in self.forbidden:p.stop()
    def phase(self,name):return self.adapter.phase(name,str(self.adapter.run),self.adapter.plan,4600)
    def test_construction_has_no_runtime_effects(self):self.assertEqual(self.fake.calls,[])
    def test_supported_browser_context_is_fresh_but_not_new_origin_reachability(self):
        p={'browser':'Chrome extension','url':'http://127.0.0.1:3118/review/auth/login','denied_route_retried':False,'observed_at':999}
        self.assertTrue(h.browser_context(p,1000))
        for change in [{'url':'http://localhost:3118'},{'browser':'headless'},{'observed_at':1},{'denied_route_retried':True}]:self.assertFalse(h.browser_context({**p,**change},1000))
    def test_guard_handles_deadline_parent_loss_and_pid_reuse(self):
        c={'deadline':4600,'parent_pid':12,'parent_ticks':'same'}
        self.assertFalse(h.guard_should_stop(c,1000,lambda p:'same'))
        self.assertTrue(h.guard_should_stop(c,4420,lambda p:'same'))
        self.assertTrue(h.guard_should_stop(c,1000,lambda p:'reused'))
        def missing(p):raise ProcessLookupError()
        self.assertTrue(h.guard_should_stop(c,1000,missing))
    def test_start_uses_only_scoped_services_no_pull_build_or_extra_ports(self):
        with patch.object(h,'protected') as save:self.phase('start');save.assert_called_once()
        args=next(args for args,kwargs in self.fake.calls if 'up' in args)
        self.assertIn('--pull',args);self.assertIn('never',args);self.assertIn('--no-build',args)
        self.assertEqual(args[-8:],list(self.adapter.plan.services));self.assertIn('01coding-checkpoint-browser-20261028',args)
    def test_scoped_sql_is_a_separate_broker_phase_not_root_migrator(self):
        self.phase('apply_scoped_sql');args=self.fake.calls[-1][0]
        self.assertEqual(args[2],'apply_scoped_sql');self.assertNotIn('db:migrate',args);self.assertEqual(self.fake.calls[-1][1]['timeout'],180)
    def test_issue_phase_starts_app_only_after_broker_success(self):
        events=[];self.adapter.start_app=lambda:events.append('app')
        self.phase('issue_restricted_access');self.assertEqual(events,['app']);self.assertEqual(self.fake.calls[-1][0][2],'issue_restricted_access')
    def test_source_change_blocks_work(self):
        self.adapter.read=lambda:{'head':'different'}
        with self.assertRaises(h.scope.ScopeError):self.phase('start')
        self.assertEqual(len(self.fake.calls),1)
    def test_cleanup_cutoff_cannot_issue_or_extend_access(self):
        self.adapter.now=lambda:4420
        with self.assertRaises(h.scope.ScopeError):self.phase('issue_restricted_access')
        self.assertEqual(self.fake.calls,[])
    def test_unknown_phase_is_rejected(self):
        with self.assertRaises(h.scope.ScopeError):self.phase('run_hidden_tests')
    def test_sensitive_command_gate_releases_only_after_identity_is_recorded(self):
        process=Mock(pid=123,returncode=0);process.communicate.return_value=(b'OK',b'');process.poll.return_value=0
        with patch.object(h.subprocess,'Popen',return_value=process) as popen,patch.object(h,'tick',return_value='ticks'),patch.object(h,'protected') as record:
            result=h.Commands().run(['node','owned-broker'],env={'CHECKPOINT_REHEARSAL_CONTROL':'/fake-private'},cwd='/fake-private',input=b'data')
            self.assertEqual(result,b'OK');self.assertIn(h.GATE,popen.call_args.args[0]);self.assertTrue(record.called);process.communicate.assert_called_once_with(input=b'1data',timeout=60)
    def test_journal_failure_sends_eof_without_starting_sensitive_command(self):
        process=Mock(pid=123);process.communicate.return_value=(b'',b'')
        with patch.object(h.subprocess,'Popen',return_value=process),patch.object(h,'tick',return_value='ticks'),patch.object(h,'protected',side_effect=OSError('fake disk failure')):
            with self.assertRaises(OSError):h.Commands().run(['node','owned-broker'],env={'CHECKPOINT_REHEARSAL_CONTROL':'/fake-private'},cwd='/fake-private')
            process.communicate.assert_called_once_with(input=b'',timeout=h.COMMAND_TERM_GRACE_SECONDS)
    def test_bootstrap_recovery_keeps_original_deadline_and_refuses_uncertain_or_post_sql_state(self):
        c={'project':h.scope.Plan().project,'database':h.scope.Plan().database,'scope_sha256':h.scope.scope_digest(),'started':1000,'deadline':4600,'phases':[{'starting':'stage'},'stage',{'starting':'start'}]}
        o={'started':1000,'deadline':4600,'assertions_passed':False,'cleanup_verified':True};cleanup={'access_disabled':True,'retained':True,'no_permanent_deletion':True}
        self.assertTrue(h.validate_bootstrap_recovery(c,o,cleanup,1200,4600,False,False))
        for sql,people,deadline,now in [(True,False,4600,1200),(False,True,4600,1200),(False,False,8200,1200),(False,False,4600,4420)]:
            with self.subTest(sql=sql,people=people,deadline=deadline,now=now),self.assertRaises(h.scope.ScopeError):h.validate_bootstrap_recovery(c,o,cleanup,now,deadline,sql,people)
        with self.assertRaises(h.scope.ScopeError):h.validate_bootstrap_recovery(c,{**o,'cleanup_verified':False},cleanup,1200,4600,False,False)
    def test_owned_stop_refuses_retain_false(self):
        with self.assertRaises(h.scope.ScopeError):self.adapter.revoke_and_stop(str(self.adapter.run),self.adapter.plan,retain=False)

    def test_attempt002_constructor_and_start_select_only_new_profile(self):
        adapter=h.LiveAdapter('/repo','/public-template',{},self.fake,now=lambda:1000,profile='attempt002')
        self.assertEqual(self.fake.calls,[])
        self.assertEqual(adapter.profile,'attempt002')
        self.assertEqual(adapter.env['CHECKPOINT_REHEARSAL_PROFILE'],'attempt002')
        self.assertEqual(str(adapter.run),h.scope.plan_for('attempt002').directory)
        adapter.journal=lambda *args:None;adapter.read=lambda:{'head':'expected-head','baseline_containers':[]};adapter.guard_identity=lambda:None
        with patch.object(h,'protected'):adapter.phase('start',str(adapter.run),adapter.plan,4600)
        argv=next(args for args,kwargs in self.fake.calls if 'up' in args)
        self.assertIn(adapter.plan.project,argv)
        self.assertNotIn(h.scope.Plan().project,argv)
        self.assertEqual(self.fake.calls[0][1]['env']['CHECKPOINT_REHEARSAL_PROFILE'],'attempt002')

    def test_attempt002_guard_receives_explicit_profile_without_launching_process(self):
        adapter=h.LiveAdapter('/repo','/public-template',{},self.fake,now=lambda:1000,profile='attempt002')
        child=Mock(pid=123)
        with patch.object(h.os,'open',return_value=10),patch.object(h.os,'close'),patch.object(h,'protected'),patch.object(h,'tick',return_value='ticks'),patch.object(h.Path,'exists',return_value=True),patch.object(h.subprocess,'Popen',return_value=child) as launch:
            guard=adapter.arm_guard(str(adapter.run),4600,parent_loss=True,retain=True)
        argv=launch.call_args.args[0]
        self.assertEqual(argv[-3:],['--watch','--profile','attempt002'])
        self.assertEqual(guard,{'deadline':4600,'independent':True,'parent_loss':True})


    def test_execute_requires_separate_trusted_owner_fields_before_receipt_or_adapter(self):
        argv=['checkpoint-auth-live-adapter.py','--execute','--approval-file','/not-read','--browser-context','/not-read','--template','/not-read']
        with patch.object(h.sys,'argv',argv),patch.object(h,'LiveAdapter') as adapter,patch.object(h.sys,'stderr'):
            with self.assertRaises(SystemExit) as error:h.main()
        self.assertEqual(error.exception.code,2);adapter.assert_not_called()



class CleanupClock:
    def __init__(self):self.wall=1000.0;self.mono=500.0
    def advance(self,seconds):self.wall+=seconds;self.mono+=seconds


def fake_adapter(clock):
    with patch.object(h.Path,'exists',return_value=False):
        adapter=h.LiveAdapter('/repo','/public-template',{},now=lambda:clock.wall,monotonic=lambda:clock.mono)
    adapter.run=Path('/source-only-fake-run')
    return adapter


class CleanupCommands:
    def __init__(self,adapter,clock,provider_fails=False,daemon_fails=False,unowned=False):
        self.adapter=adapter;self.clock=clock;self.provider_fails=provider_fails;self.daemon_fails=daemon_fails;self.calls=[]
        self.ids=['owned-'+str(i) for i in range(8)];self.running=set(self.ids);self.unowned=unowned
    def run(self,args,**kwargs):
        self.calls.append((args,kwargs));self.clock.advance(float(kwargs['timeout'])+h.COMMAND_TERMINATION_RESERVE)
        if len(args)>2 and args[2] in ['disable','disable_sql_access']:
            if args[2]=='disable' and self.provider_fails:raise RuntimeError('DO_NOT_DISCLOSE_PROVIDER_SECRET')
            return b''
        if args[:3]==['docker','ps','-aq']:return ('\n'.join(self.ids)+'\n').encode()
        if args[:2]==['docker','inspect']:
            return ('\n'.join(json.dumps([cid,True,self.adapter.plan.project,self.adapter.plan.services[i],str(self.adapter.run/'stack')]) for i,cid in enumerate(self.ids))+'\n').encode()
        if args[:2]==['docker','stop']:
            if self.daemon_fails:raise RuntimeError('DO_NOT_DISCLOSE_DAEMON_SECRET')
            self.running.difference_update(args[4:]);return b''
        if args[:3]==['docker','ps','-q']:return ('\n'.join(sorted(self.running))).encode()
        raise AssertionError('Unexpected non-fake cleanup command')


class CleanupBudgetTests(unittest.TestCase):
    def run_cleanup(self,*,remaining=180,provider_fails=False,daemon_fails=False,unowned=False):
        clock=CleanupClock();adapter=fake_adapter(clock)
        commands=CleanupCommands(adapter,clock,provider_fails,daemon_fails,unowned);adapter.commands=commands
        control={'deadline':clock.wall+remaining,'monotonic_deadline':clock.mono+remaining,'phases':[{'starting':'issue_restricted_access'}],'baseline_containers':[commands.ids[0]] if unowned else []}
        adapter.read=lambda:control;receipts={};failure=None
        def save(path,value):receipts[Path(path).name]=value
        with patch.object(h.Path,'exists',return_value=False),patch.object(h,'protected',side_effect=save),patch.object(h.subprocess,'Popen',side_effect=AssertionError('No processes')),patch.object(h.socket,'socket',side_effect=AssertionError('No sockets')):
            try:adapter._revoke_and_stop(adapter.plan)
            except h.scope.ScopeError as error:failure=error
        return clock,adapter,commands,control,receipts,failure
    def test_worst_case_bounded_calls_leave_time_and_stop_all_owned_containers_in_one_batch(self):
        clock,adapter,commands,control,receipts,failure=self.run_cleanup()
        self.assertIsNone(failure);self.assertLess(clock.wall,control['deadline']);self.assertLess(clock.mono,control['monotonic_deadline'])
        stops=[args for args,_ in commands.calls if args[:2]==['docker','stop']];inspects=[args for args,_ in commands.calls if args[:2]==['docker','inspect']]
        self.assertEqual(len(stops),1);self.assertEqual(set(stops[0][4:]),set(commands.ids));self.assertEqual(len(inspects),1)
        self.assertEqual(inspects[0][2:4],['--format',h.OWNERSHIP_FORMAT]);self.assertNotIn('Env',h.OWNERSHIP_FORMAT)
        self.assertTrue(receipts['cleanup.json']['shutdown_verified']);self.assertTrue(receipts['cleanup.json']['original_deadline_met'])
    def test_provider_failure_preserves_shutdown_budget_and_never_claims_revocation_success(self):
        clock,adapter,commands,control,receipts,failure=self.run_cleanup(provider_fails=True)
        self.assertIsNotNone(failure);self.assertFalse(receipts['cleanup.json']['access_disabled']);self.assertFalse(receipts['cleanup.json']['shutdown_verified'])
        self.assertTrue(any(args[2]=='disable_sql_access' for args,_ in commands.calls if len(args)>2))
        self.assertFalse(commands.running);self.assertLess(clock.wall,control['deadline']);self.assertNotIn('DO_NOT_DISCLOSE',str(receipts))
    def test_late_cleanup_only_stops_without_refresh_or_renewal_and_records_missed_deadline(self):
        clock,adapter,commands,control,receipts,failure=self.run_cleanup(remaining=-1)
        self.assertIsNotNone(failure);self.assertFalse(any(len(args)>2 and args[2] in ['disable','disable_sql_access'] for args,_ in commands.calls))
        self.assertFalse(commands.running);self.assertLessEqual(clock.mono,500+h.CLEANUP_LATE_STOP_SECONDS)
        self.assertEqual(control['deadline'],999);self.assertEqual(control['monotonic_deadline'],499)
        self.assertFalse(receipts['cleanup.json']['original_deadline_met']);self.assertFalse(receipts['cleanup.json']['shutdown_verified'])
    def test_unresponsive_daemon_is_explicit_unverified_shutdown_not_success(self):
        clock,adapter,commands,control,receipts,failure=self.run_cleanup(daemon_fails=True)
        self.assertIsNotNone(failure);self.assertFalse(receipts['cleanup.json']['shutdown_verified']);self.assertIn('container_stop_unverified',receipts['cleanup.json']['errors'])
        self.assertLess(clock.wall,control['deadline']);self.assertNotIn('DO_NOT_DISCLOSE',str(receipts))
    def test_baseline_or_unknown_container_never_receives_stop_signal(self):
        clock,adapter,commands,control,receipts,failure=self.run_cleanup(unowned=True)
        self.assertIsNotNone(failure);stops=[args for args,_ in commands.calls if args[:2]==['docker','stop']]
        self.assertNotIn(commands.ids[0],stops[0]);self.assertEqual(set(stops[0][4:]),set(commands.ids[1:]));self.assertFalse(receipts['cleanup.json']['shutdown_verified'])
    def test_wall_and_monotonic_deadlines_both_bound_work(self):
        clock=CleanupClock();c={'deadline':1180,'monotonic_deadline':680};budget=h.CleanupBudget(c,lambda:clock.wall,lambda:clock.mono)
        clock.mono=679;self.assertEqual(budget.remaining(),1)
        with self.assertRaises(h.scope.ScopeError):budget.timeout(5)
        clock.mono=500;clock.wall=1181;self.assertEqual(budget.remaining(),0);budget.begin_stop_only()
        self.assertFalse(budget.provider_allowed());self.assertEqual(c,{'deadline':1180,'monotonic_deadline':680});self.assertFalse(budget.met_original_deadline())
    def test_contended_cleanup_lock_has_five_second_bound_without_starting_commands(self):
        clock=CleanupClock();adapter=fake_adapter(clock);adapter.read=lambda:{'deadline':1180,'monotonic_deadline':680};adapter.command=Mock(side_effect=AssertionError('No commands'))
        with patch.object(h.os,'open',return_value=123),patch.object(h.os,'close'),patch.object(h.fcntl,'flock',side_effect=BlockingIOError()),patch.object(h.time,'sleep',side_effect=clock.advance):
            with self.assertRaises(h.scope.ScopeError):adapter.revoke_and_stop(str(adapter.run),adapter.plan)
        self.assertLessEqual(clock.mono,505.01);adapter.command.assert_not_called()
    def test_reused_process_pid_is_not_signalled(self):
        clock=CleanupClock();adapter=fake_adapter(clock);budget=h.CleanupBudget({'deadline':1180,'monotonic_deadline':680},lambda:clock.wall,lambda:clock.mono)
        with patch.object(h.Path,'exists',return_value=True),patch.object(h.os,'pidfd_open',return_value=123),patch.object(h.os,'close'),patch.object(h,'tick',return_value='different'),patch.object(h.os,'killpg') as group,patch.object(h.signal,'pidfd_send_signal') as direct:
            with self.assertRaises(h.scope.ScopeError):adapter._stop_recorded_process({'pid':44,'ticks':'original'},budget,phase=True)
        group.assert_not_called();direct.assert_not_called()


class SourceAndCommandTests(unittest.TestCase):
    def test_timeout_has_only_bounded_term_and_kill_grace(self):
        process=Mock(pid=123,returncode=-9);process.poll.return_value=None
        process.communicate.side_effect=[h.subprocess.TimeoutExpired('fake',2),h.subprocess.TimeoutExpired('fake',.5),(b'',b'')]
        with patch.object(h.subprocess,'Popen',return_value=process),patch.object(h,'tick',return_value='ticks'),patch.object(h.os,'getpgid',return_value=123),patch.object(h.os,'killpg') as kill:
            with self.assertRaises(h.scope.ScopeError):h.Commands().run(['fake'],env={},cwd='/source-only',timeout=2)
        self.assertEqual([c.kwargs['timeout'] for c in process.communicate.call_args_list],[2,.5,.5])
        self.assertEqual(kill.call_args_list,[call(123,h.signal.SIGTERM),call(123,h.signal.SIGKILL)])
    def test_exact_image_map_rejects_a_different_valid_digest(self):
        plan=h.scope.Plan();images={name:'public/'+name+'@sha256:'+hashlib.sha256(name.encode()).hexdigest() for name in plan.services}
        config={'name':plan.project,'services':{name:{'container_name':plan.project+'-'+name,'restart':'no','image':images[name],'environment':{'database':'/'+plan.database},'ports':[{'host_ip':'127.0.0.1','published':56532 if name=='db' else 56531}] if name in ['db','api-gw'] else []} for name in plan.services}}
        h.validate_effective(config,plan,images)
        config['services']['db']['image']='public/other@sha256:'+'f'*64
        with self.assertRaises(h.scope.ScopeError):h.validate_effective(config,plan,images)
        with self.assertRaises(h.scope.ScopeError):h.validate_effective(config,plan,{})
    def test_immutable_lock_uses_only_snapshot_not_later_repo_file(self):
        clock=CleanupClock();adapter=fake_adapter(clock);images={name:'public/'+name+'@sha256:'+'a'*64 for name in adapter.plan.services}
        data=json.dumps({'commit':adapter.plan.upstream_commit,'images':images}).encode();adapter.read=lambda:{'source_lock_sha256':hashlib.sha256(data).hexdigest()}
        snapshot=adapter.run/'adapter-code/checkpoint-auth-source-lock.json'
        def read(p):
            self.assertEqual(p,snapshot);return data
        with patch.object(h.Path,'read_bytes',read):self.assertEqual(adapter.pinned_images(),images)
        with patch.object(h.Path,'read_bytes',return_value=b'changed'):
            with self.assertRaises(h.scope.ScopeError):adapter.pinned_images()
    def test_reservation_copies_verified_public_lock_privately_and_binds_hash(self):
        clock=CleanupClock();adapter=fake_adapter(clock);adapter.source_lock_bytes=b'{"public":"lock"}';adapter.source_lock_sha256=hashlib.sha256(adapter.source_lock_bytes).hexdigest();adapter.head='reviewed-head';adapter.command=lambda *a,**k:b''
        manager=MagicMock();stream=manager.__enter__.return_value;stream.fileno.return_value=123
        with patch.object(h.Path,'is_symlink',return_value=False),patch.object(h.Path,'mkdir'),patch.object(h.Path,'read_bytes',return_value=b'public code'),patch.object(h.os,'chmod'),patch.object(h.os,'open',return_value=123) as opened,patch.object(h.os,'fdopen',return_value=manager),patch.object(h.os,'fsync'),patch.object(h,'tick',return_value='ticks'),patch.object(h,'protected') as protected:
            adapter.reserve_fresh(adapter.plan,{'started':1000,'deadline':4600})
        self.assertEqual(protected.call_args.args[1]['source_lock_sha256'],adapter.source_lock_sha256)
        self.assertEqual(stream.write.call_args_list[-1],call(adapter.source_lock_bytes))
        item=next(c for c in opened.call_args_list if str(c.args[0]).endswith('checkpoint-auth-source-lock.json'))
        self.assertEqual(item.args[2],0o600);self.assertTrue(item.args[1]&h.os.O_EXCL)
    def test_source_hygiene_allows_only_known_unrelated_paths_and_blocks_before_images_ports(self):
        self.assertEqual(h.runtime_source_changes(list(h.UNRELATED_DIRTY_ALLOWLIST)),[])
        self.assertEqual(h.runtime_source_changes(['docs/note.md']),[])
        for name in ['scripts/changed.py','apps/web/page.tsx','packages/domain/index.ts','infra/template.yml','tests/new.ts','package.json','pnpm-lock.yaml','tsconfig.json','.env.local','.prettierrc']:
            self.assertEqual(h.runtime_source_changes([name]),[name])
        clock=CleanupClock();adapter=fake_adapter(clock);calls=[]
        def command(args,**kwargs):
            calls.append(args);return b'scripts/changed.py\0' if args[:2]==['git','diff'] else b''
        adapter.command=command
        with patch.object(h.socket,'socket',side_effect=AssertionError('No ports')):
            with self.assertRaises(h.scope.ScopeError):adapter.preflight(adapter.plan)
        self.assertEqual(len(calls),2);self.assertTrue(all(args[0]=='git' for args in calls))



class SqlPreflightTests(unittest.TestCase):
    def fixture(self):
        repo=Path('/source-only-repo');registered=[repo/f'packages/db/migrations/{i:04d}_public.sql' for i in range(11)]
        files=[*registered,repo/'packages/db/migration-drafts/0011_checkpoint_drafts.DRAFT.sql',repo/'packages/db/migration-drafts/0014_checkpoint_editor_context.DRAFT.sql']
        body=b'public SQL fixture only';locked={str(p.relative_to(repo)):hashlib.sha256(body).hexdigest() for p in files}
        return repo,registered,files,body,locked
    def test_sql_prerequisite_set_and_hashes_are_exact_without_execution(self):
        repo,registered,files,body,locked=self.fixture()
        with patch.object(h.Path,'glob',return_value=registered),patch.object(h.Path,'is_file',return_value=True),patch.object(h.Path,'is_symlink',return_value=False),patch.object(h.Path,'read_bytes',return_value=body):
            self.assertEqual(h.verify_sql_sources(repo,locked),locked)
            for wrong in [{},dict(list(locked.items())[:-1]),{**locked,'packages/db/migration-drafts/0012_NOT_APPROVED.sql':'f'*64},{**locked,next(iter(locked)):'f'*64}]:
                with self.subTest(lock=wrong),self.assertRaises(h.scope.ScopeError):h.verify_sql_sources(repo,wrong)
        for wrong in [registered[:-1],[*registered,repo/'packages/db/migrations/0012_extra.sql']]:
            with patch.object(h.Path,'glob',return_value=wrong),self.assertRaises(h.scope.ScopeError):h.verify_sql_sources(repo,locked)
        with patch.object(h.Path,'glob',return_value=registered),patch.object(h.Path,'is_file',return_value=False),self.assertRaises(h.scope.ScopeError):h.verify_sql_sources(repo,locked)
    def test_sql_preflight_failure_precedes_images_ports_or_reservation(self):
        clock=CleanupClock();adapter=fake_adapter(clock);repo,registered,files,body,locked=self.fixture();adapter.repo=repo
        adapter.browser={'browser':'Chrome extension','url':'http://127.0.0.1:3118/review/auth/login','denied_route_retried':False,'observed_at':1000}
        source={'commit':adapter.plan.upstream_commit,'images':{x:'public/'+x+'@sha256:'+'a'*64 for x in adapter.plan.services},'files':{},'sql':{}}
        calls=[]
        def command(args,**kwargs):calls.append(args);return b''
        adapter.command=command
        with patch.object(h.Path,'exists',return_value=False),patch.object(h.Path,'read_bytes',return_value=json.dumps(source).encode()),patch.object(h.Path,'glob',return_value=registered),patch.object(h.socket,'socket',side_effect=AssertionError('No port access')):
            with self.assertRaises(h.scope.ScopeError):adapter.preflight(adapter.plan)
        self.assertEqual(len(calls),2);self.assertTrue(all(args[0]=='git' for args in calls))



class DirectBuildTests(unittest.TestCase):
    def manifests(self):
        root={'name':'nextera-piscine','engines':{'node':'24.19.0'},'devDependencies':{'typescript':'5.9.3'},'scripts':{'build':'pnpm --filter @nextera/domain build && pnpm --filter @nextera/db build && pnpm --filter @nextera/web build'}}
        return {'package.json':root,'packages/domain/package.json':{'name':'@nextera/domain','scripts':{'build':'tsc -p tsconfig.json'}},'packages/db/package.json':{'name':'@nextera/db','scripts':{'build':'tsc -p tsconfig.json'}},'apps/web/package.json':{'name':'@nextera/web','scripts':{'build':'next build'},'dependencies':{'next':'16.4.2'}}}
    def plan_with(self,manifests,exists=True):
        repo=Path('/repo');source=Path('/source-only-snapshot')
        def read(p):
            if p==repo/'node_modules/typescript/package.json':return json.dumps({'version':'5.9.3'})
            if p==repo/'apps/web/node_modules/next/package.json':return json.dumps({'version':'16.4.2'})
            return json.dumps(manifests[str(p.relative_to(source))])
        def resolve(p):
            return repo/'node_modules/.pnpm/next-public/dist/bin/next' if p==repo/'apps/web/node_modules/next/dist/bin/next' else p
        with patch.object(h.Path,'read_text',read),patch.object(h.Path,'is_file',return_value=exists),patch.object(h.Path,'resolve',resolve),patch.object(h.os,'access',return_value=True):
            return h.direct_build_plan(repo,source)
    def test_exact_declared_build_scripts_use_only_installed_node_compilers_in_order(self):
        plan=self.plan_with(self.manifests())
        self.assertEqual([p['cwd'] for p in plan],['/source-only-snapshot/packages/domain','/source-only-snapshot/packages/db','/source-only-snapshot/apps/web'])
        self.assertEqual(plan[0]['argv'],['/repo/.tools/node-v24.19.0-linux-x64/bin/node','/repo/node_modules/typescript/bin/tsc','-p','tsconfig.json'])
        self.assertEqual(plan[1]['argv'],plan[0]['argv'])
        self.assertEqual(plan[2]['argv'],['/repo/.tools/node-v24.19.0-linux-x64/bin/node','/repo/apps/web/node_modules/next/dist/bin/next','build'])
        self.assertFalse(any(token in ['pnpm','npm','npx','install','--force'] for p in plan for token in p['argv']))
    def test_unknown_scripts_or_hooks_are_rejected_without_executing_anything(self):
        cases=[('apps/web/package.json','build','next build && npm install'),('packages/domain/package.json','build','tsc -p unreviewed.json'),('package.json','build','pnpm install'),('packages/db/package.json','prebuild','curl example.invalid')]
        for filename,key,value in cases:
            manifests=self.manifests();manifests[filename]['scripts'][key]=value
            with self.subTest(filename=filename,key=key),self.assertRaises(h.scope.ScopeError):h.validate_build_scripts(manifests)
    def test_missing_cli_cannot_trigger_install_or_provisioning(self):
        with self.assertRaises(h.scope.ScopeError):self.plan_with(self.manifests(),exists=False)
    def test_snapshot_build_runs_direct_plan_through_registered_command_interface(self):
        clock=CleanupClock();adapter=fake_adapter(clock);commands=FakeCommands();adapter.commands=commands
        adapter.read=lambda:{'deadline':4600,'monotonic_deadline':4100};adapter.guard_identity=Mock()
        plan=self.plan_with(self.manifests());env={'DATABASE_URL':'FAKE_RESTRICTED_WEB_ONLY','CHECKPOINT_REHEARSAL_CONTROL':'/source-only-fake-run'}
        with patch.object(h,'direct_build_plan',return_value=plan),patch.object(h.Path,'glob',return_value=[]),patch.object(h.subprocess,'Popen',side_effect=AssertionError('No real build')):
            self.assertEqual(adapter.build_snapshot(Path('/source-only-snapshot'),env),plan)
        self.assertEqual(len(commands.calls),3)
        for (argv,kwargs),step in zip(commands.calls,plan):
            self.assertEqual(argv,step['argv']);self.assertEqual(kwargs['cwd'],Path(step['cwd']));self.assertEqual(kwargs['env'],{**env,'CI':'1','NEXT_TELEMETRY_DISABLED':'1'});self.assertLessEqual(kwargs['timeout'],240)
        self.assertEqual(adapter.guard_identity.call_count,3)
    def test_snapshot_environment_files_are_metadata_rejection_not_reads(self):
        with patch.object(h.Path,'glob',return_value=[Path('/source-only-snapshot/.env.local')]),patch.object(h.Path,'read_text',side_effect=AssertionError('No secret reads')):
            with self.assertRaises(h.scope.ScopeError):h.validate_build_source_environment('/source-only-snapshot')
    def test_build_does_not_start_after_original_cleanup_cutoff(self):
        clock=CleanupClock();adapter=fake_adapter(clock);adapter.commands=FakeCommands();adapter.read=lambda:{'deadline':1180,'monotonic_deadline':680};adapter.guard_identity=lambda:None
        with patch.object(h,'direct_build_plan',return_value=self.plan_with(self.manifests())),patch.object(h.Path,'glob',return_value=[]):
            with self.assertRaises(h.scope.ScopeError):adapter.build_snapshot(Path('/source-only-snapshot'),{})
        self.assertEqual(adapter.commands.calls,[])
    def test_constructor_never_probes_retained_lease_paths(self):
        with patch.object(h.Path,'exists',side_effect=AssertionError('No retained lease probe')):
            adapter=h.LiveAdapter('/repo','/public-template',{},FakeCommands())
        self.assertEqual(adapter.broker,str(adapter.run/'adapter-code/checkpoint-auth-runtime.mjs'))



class SnapshotDependencyTests(unittest.TestCase):
    def fixture(self,base):
        repo=base/'original-source';snapshot=base/'source-snapshot'
        for root in [repo,snapshot]:
            for folder in ['packages/domain','packages/db','apps/web']:(root/folder).mkdir(parents=True)
        for relative in ['node_modules','apps/web/node_modules','packages/db/node_modules']:
            modules=repo/relative;(modules/'@nextera').mkdir(parents=True)
            for name in ['domain','db']:(modules/'@nextera'/name).symlink_to(repo/'packages'/name,target_is_directory=True)
            (modules/'public-vendor').mkdir();(modules/'public-vendor/package.json').write_text('{"public":"fixture"}')
        (repo/'node_modules/.modules.yaml').write_text('fake package-manager state')
        return repo,snapshot
    def test_workspace_aliases_resolve_inside_snapshot_while_vendor_links_are_reused(self):
        with tempfile.TemporaryDirectory(prefix='public-source-links-') as directory:
            repo,snapshot=self.fixture(Path(directory));h.link_snapshot_dependencies(repo,snapshot)
            for relative in ['node_modules','apps/web/node_modules','packages/db/node_modules']:
                for alias in ['domain','db']:
                    self.assertEqual((snapshot/relative/'@nextera'/alias).resolve(),snapshot/'packages'/alias)
                    self.assertEqual((repo/relative/'@nextera'/alias).resolve(),repo/'packages'/alias)
                self.assertEqual((snapshot/relative/'public-vendor').resolve(),repo/relative/'public-vendor')
            self.assertFalse((snapshot/'packages/domain/node_modules').exists())
            self.assertFalse((snapshot/'node_modules/.modules.yaml').exists())
            self.assertEqual((repo/'node_modules/.modules.yaml').read_text(),'fake package-manager state')
            self.assertEqual((repo/'node_modules/public-vendor/package.json').read_text(),'{"public":"fixture"}')
    def test_existing_snapshot_links_and_original_dependencies_are_never_removed_or_replaced(self):
        with tempfile.TemporaryDirectory(prefix='public-source-links-') as directory:
            repo,snapshot=self.fixture(Path(directory));h.link_snapshot_dependencies(repo,snapshot)
            with self.assertRaises(h.scope.ScopeError):h.link_snapshot_dependencies(repo,snapshot)
            with self.assertRaises(h.scope.ScopeError):h.link_snapshot_dependencies(repo,repo)
            self.assertTrue((repo/'node_modules/public-vendor/package.json').is_file())
            self.assertEqual((snapshot/'node_modules/@nextera/domain').resolve(),snapshot/'packages/domain')


if __name__=='__main__':unittest.main()
