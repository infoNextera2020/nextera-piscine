"""Injected tests only: no process, socket, database, credentials or provider calls."""
from dataclasses import replace, FrozenInstanceError
import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('checkpoint_auth_rehearsal', Path(__file__).resolve().parents[1] / 'checkpoint-auth-rehearsal.py')
if not Path(spec.origin).exists():
    spec = importlib.util.spec_from_file_location('checkpoint_auth_rehearsal', Path(__file__).with_name('checkpoint_auth_rehearsal.py'))
h = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = h
spec.loader.exec_module(h)


class FakeRuntime:
    kind = 'injected_fake_not_integration_evidence'
    def __init__(self):
        self.events=[]; self.fail=None; self.clock=1000; self.expire=None; self.stopped=True
        p=h.Plan()
        self.proof={k:True for k in ['fresh_directory','fresh_project','fresh_volumes','ports_available','pinned_images_available','template_digest_verified','browser_target_permitted','cleanup_supported']}
        self.proof.update(database=p.database,project=p.project,migrations=list(p.migrations),bindings=[list(b) for b in p.bindings],role_memberships=list(p.role_memberships),services=list(p.services))
    def preflight(self,p):self.events.append('preflight');return self.proof
    def reserve_fresh(self,p,o):self.events.append('reserve');return 'fake-reservation'
    def arm_guard(self,r,d,**kw):self.events.append('guard');return {'deadline':d,'independent':True,'parent_loss':True}
    def phase(self,name,*args):
        self.events.append(name)
        if self.expire==name:self.clock=5000
        if self.fail==name:raise RuntimeError('DO_NOT_SERIALIZE_SECRET')
    def journal(self,*args):self.events.append('journal')
    def revoke_and_stop(self,*args,**kw):
        assert kw=={'retain':True};self.events.append('cleanup')
        if self.fail=='cleanup':raise RuntimeError('provider failure')
    def verify_stopped(self,*args):self.events.append('verify');return self.stopped


class GuardTests(unittest.TestCase):
    def setUp(self):
        self.f=FakeRuntime();self.owner=h.OwnerApproval('Sentinel_'+'a'*32,'1970-01-01T00:16:40Z',h.scope_digest());self.approval=h.approval_receipt(self.owner,h.Plan(),1000)
        self.no_run=patch('subprocess.run',side_effect=AssertionError('Real process forbidden'));self.no_run.start()
        self.no_socket=patch('socket.socket',side_effect=AssertionError('Real socket forbidden'));self.no_socket.start()
    def tearDown(self):self.no_run.stop();self.no_socket.stop()
    def run_fake(self):return h.exercise_injected(self.f,self.approval,lambda:self.f.clock,owner_approval=self.owner)
    def test_plan_is_proposed_and_legacy_duration_is_honest(self):
        p=h.proposal();self.assertEqual(p['status'],'proposed_not_authorized');self.assertEqual(p['plan']['checkpoint_seconds'],5400);self.assertEqual(p['plan']['maximum_seconds'],3600);self.assertFalse(p['plan']['offline_recovery'])
    def test_scope_changes_require_new_review(self):
        for p in [replace(h.Plan(),checkpoint_seconds=600),replace(h.Plan(),maximum_seconds=7200),replace(h.Plan(),offline_recovery=True),replace(h.Plan(),migrations=('0012',))]:
            with self.subTest(p=p),self.assertRaises(h.ScopeError):h.proposal(p)
    def test_approval_required_before_any_adapter_call(self):
        self.approval['confirmed_at_action_time']=False
        with self.assertRaises(h.ScopeError):self.run_fake()
        self.assertEqual(self.f.events,[])
    def test_wrong_or_expired_approval(self):
        for suffix, stamp in [('1','1970-01-01T00:15:39Z'),('2','1970-01-01T00:16:41Z')]:
            owner=h.OwnerApproval('Sentinel_'+'b'*31+suffix,stamp,h.scope_digest())
            receipt=h.approval_receipt(owner,h.Plan(),max(1000,owner.epoch))
            with self.subTest(stamp=stamp),self.assertRaises(h.ScopeError):h.exercise_injected(self.f,receipt,lambda:1000,owner_approval=owner)
        self.approval['scope_sha256']='wrong'
        with self.assertRaises(h.ScopeError):self.run_fake()
    def test_every_preflight_gate_fails_closed(self):
        for field,value in list(self.f.proof.items()):
            self.f.proof[field]=False
            with self.subTest(field=field),self.assertRaises(h.ScopeError):self.run_fake()
            self.assertNotIn('reserve',self.f.events);self.f.proof[field]=value
    def test_no_access_before_verified_guard_and_scoped_sql(self):
        result=self.run_fake();self.assertTrue(result['assertions_passed']);self.assertTrue(result['cleanup_verified'])
        events=self.f.events
        self.assertLess(events.index('guard'),events.index('start'));self.assertLess(events.index('apply_scoped_sql'),events.index('issue_restricted_access'));self.assertLess(events.index('cleanup'),events.index('verify'))
        self.assertEqual(result['runtime_kind'],'injected_fake_not_integration_evidence')
    def test_each_partial_failure_cleans_up_without_leaking_error(self):
        for phase in ['stage','start','apply_scoped_sql','issue_restricted_access','assert_http_and_browser']:
            self.f=FakeRuntime();self.f.fail=phase;result=self.run_fake()
            self.assertFalse(result['assertions_passed']);self.assertTrue(result['cleanup_verified']);self.assertNotIn('DO_NOT_SERIALIZE_SECRET',str(result))
    def test_expiry_does_not_renew_or_issue_access(self):
        self.f.expire='start';result=self.run_fake();self.assertFalse(result['assertions_passed']);self.assertNotIn('issue_restricted_access',self.f.events);self.assertIn('cleanup',self.f.events)
    def test_cleanup_failure_is_explicit_not_success(self):
        self.f.fail='cleanup';result=self.run_fake();self.assertFalse(result['cleanup_verified']);self.assertEqual(result['failure'],'cleanup_unverified_do_not_restart')
    def test_stale_listeners_or_guard_process_fail_cleanup_receipt(self):
        self.f.stopped=False;result=self.run_fake();self.assertFalse(result['cleanup_verified'])

    def test_closed_attempt002_profile_has_distinct_identity_and_unchanged_limits(self):
        original=h.plan_for('attempt001');fresh=h.plan_for('attempt002')
        self.assertEqual(h.scope_digest(original),'c59bed18ea9a12306cc6b59b0cb31cba7f094f209834bb12d1f5c53c761cb4fc')
        self.assertNotEqual(h.scope_digest(fresh),h.scope_digest(original))
        for name in ['project','directory','database','login_role','learners']:
            self.assertNotEqual(getattr(original,name),getattr(fresh,name))
        self.assertFalse(set(original.learners).intersection(fresh.learners))
        for name in h.asdict(original):
            if name not in ['project','directory','database','login_role','learners']:
                self.assertEqual(getattr(original,name),getattr(fresh,name))
        for key in ['attempt003','../attempt001','/tmp/run','']:
            with self.assertRaises(h.ScopeError):h.plan_for(key)
        for field,value in [('directory','/tmp/reused'),('database',original.database),('maximum_seconds',7200),('offline_recovery',True)]:
            with self.assertRaises(h.ScopeError):h.proposal(replace(fresh,**{field:value}))

    def test_attempt002_rejects_old_approval_before_any_adapter_operation(self):
        fresh=h.plan_for('attempt002')
        with self.assertRaises(h.ScopeError):h.exercise_injected(self.f,self.approval,lambda:1000,fresh,owner_approval=self.owner)
        self.assertEqual(self.f.events,[])
        self.f.proof.update(database=fresh.database,project=fresh.project,migrations=list(fresh.migrations),bindings=[list(x) for x in fresh.bindings],role_memberships=list(fresh.role_memberships),services=list(fresh.services))
        fresh_owner=h.OwnerApproval('Sentinel_'+'e'*32,'1970-01-01T00:16:40Z',h.scope_digest(fresh))
        approval=h.approval_receipt(fresh_owner,fresh,1000)
        outcome=h.exercise_injected(self.f,approval,lambda:1000,fresh,owner_approval=fresh_owner)
        self.assertTrue(outcome['assertions_passed']);self.assertTrue(outcome['cleanup_verified'])
        self.assertEqual(outcome['deadline']-outcome['started'],3600)
        self.assertEqual(outcome['runtime_kind'],'injected_fake_not_integration_evidence')


    def test_owner_evidence_is_frozen_and_message_time_cannot_be_reassigned(self):
        with self.assertRaises(FrozenInstanceError):self.owner.approved_at_utc='1970-01-01T00:17:41Z'
        with self.assertRaises(h.ScopeError):replace(self.owner,approved_at_utc='1970-01-01T00:17:41Z')
        self.assertEqual(self.owner.approved_at_utc,'1970-01-01T00:16:40Z')
        with self.assertRaises(h.ScopeError):replace(self.owner,scope_sha256=h.scope_digest(h.plan_for('attempt002')))
        with self.assertRaises(h.ScopeError):h.approval_receipt(self.owner,h.plan_for('attempt002'),1000)

    def test_regenerating_receipt_time_cannot_refresh_expired_owner_approval(self):
        fresh_receipt=h.approval_receipt(self.owner,h.Plan(),1061)
        self.assertEqual(fresh_receipt['owner_approved_at_utc'],self.owner.approved_at_utc)
        with self.assertRaises(h.ScopeError):h.exercise_injected(self.f,fresh_receipt,lambda:1061,owner_approval=self.owner)
        mutated={**fresh_receipt,'owner_approved_at_utc':'1970-01-01T00:17:41Z'}
        with self.assertRaises(h.ScopeError):h.exercise_injected(self.f,mutated,lambda:1061,owner_approval=self.owner)
        self.assertEqual(self.f.events,[])

    def test_legacy_or_missing_independent_owner_evidence_fails_before_adapter_calls(self):
        legacy={'scope_sha256':h.scope_digest(),'confirmed_at_action_time':True,'browser_origin':'http://127.0.0.1:3151','utc_epoch':1000}
        with self.assertRaises(h.ScopeError):h.exercise_injected(self.f,legacy,lambda:1000,owner_approval=self.owner)
        with self.assertRaises(h.ScopeError):h.exercise_injected(self.f,self.approval,lambda:1000)
        with self.assertRaises(h.ScopeError):h.OwnerApproval('',self.owner.approved_at_utc,h.scope_digest())
        with self.assertRaises(h.ScopeError):h.OwnerApproval('Sentinel_'+'d'*32,'now',h.scope_digest())
        self.assertEqual(self.f.events,[])

    def test_actual_closed_message_binding_cannot_be_reused_or_reset(self):
        owner=h.OwnerApproval('Sentinel_7b5ec1bcc1cc819187d19f16ccc96f4a','2026-10-29T09:17:11Z',h.scope_digest(h.plan_for('attempt002')))
        with self.assertRaises(h.ScopeError):h.OwnerApproval(owner.message_id,'2026-10-29T09:26:21Z',owner.scope_sha256)
        receipt=h.approval_receipt(owner,h.plan_for('attempt002'),owner.epoch)
        with self.assertRaises(h.ScopeError):h.exercise_injected(self.f,receipt,lambda:owner.epoch,h.plan_for('attempt002'),owner_approval=owner)
        self.assertEqual(self.f.events,[])

    def test_slow_preflight_requires_still_fresh_owner_approval_before_reservation(self):
        original=self.f.preflight
        def slow(plan):
            result=original(plan);self.f.clock=1061;return result
        self.f.preflight=slow
        with self.assertRaises(h.ScopeError):self.run_fake()
        self.assertEqual(self.f.events,['preflight'])

    def test_exact_sixty_second_guard_is_preserved_and_new_owner_message_is_required(self):
        h.validate_owner_approval(self.approval,self.owner,1060,h.Plan())
        with self.assertRaises(h.ScopeError):h.validate_owner_approval(self.approval,self.owner,1060.001,h.Plan())
        newer=h.OwnerApproval('Sentinel_'+'c'*32,'1970-01-01T00:17:41Z',h.scope_digest())
        receipt=h.approval_receipt(newer,h.Plan(),1061)
        self.f.clock=1061
        result=h.exercise_injected(self.f,receipt,lambda:1061,owner_approval=newer)
        self.assertTrue(result['assertions_passed'])
        self.assertEqual(result['owner_message_id'],newer.message_id)
        self.assertEqual(result['owner_approved_at_utc'],newer.approved_at_utc)


if __name__=='__main__':unittest.main()
