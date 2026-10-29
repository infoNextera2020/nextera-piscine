"""No real process/socket/provider is used. Only deterministic scope and command tests."""
from pathlib import Path
from unittest.mock import patch
import importlib.util
import sys
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
    def test_owned_stop_refuses_retain_false(self):
        with self.assertRaises(h.scope.ScopeError):self.adapter.revoke_and_stop(str(self.adapter.run),self.adapter.plan,retain=False)


if __name__=='__main__':unittest.main()
