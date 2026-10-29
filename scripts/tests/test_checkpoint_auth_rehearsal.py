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
        for key in ['attempt004','../attempt001','/tmp/run','']:
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


    def test_attempt003_source_profile_changes_only_five_unused_identities(self):
        fresh=h.plan_for('attempt003')
        identities={'project','directory','database','login_role','learners'}
        self.assertEqual(h.profile_for_plan(fresh),'attempt003')
        self.assertEqual(fresh.directory,'/home/anas/.local/share/nextera-judge/checkpoint-browser-20261029-attempt003/run-001')
        self.assertEqual(fresh.migrations,tuple(f'{n:04d}' for n in range(11))+('0011','0014'))
        self.assertEqual(fresh.services,('db','auth','rest','storage','imgproxy','meta','studio','api-gw'))
        self.assertEqual(fresh.bindings,(('gateway','127.0.0.1',56531),('db','127.0.0.1',56532),('app','127.0.0.1',3151)))
        self.assertEqual(fresh.role_memberships,('nextera_web',))
        self.assertEqual((fresh.draft_source_bytes,fresh.draft_receipts,fresh.draft_total_source_bytes,fresh.draft_retention_seconds),(1024,64,65536,600))
        self.assertEqual((fresh.maximum_seconds,fresh.auth_jwt_seconds,fresh.checkpoint_seconds),(3600,300,5400))
        self.assertFalse(fresh.offline_recovery);self.assertTrue(fresh.retain_evidence_and_data)
        for name,digest in [('attempt001','c59bed18ea9a12306cc6b59b0cb31cba7f094f209834bb12d1f5c53c761cb4fc'),('attempt002','a267f057515c96963d1c44ae2125f68b41521c822ec62fc7be48c36507724b72')]:
            closed=h.plan_for(name)
            self.assertEqual(h.scope_digest(closed),digest)
            self.assertNotEqual(h.scope_digest(fresh),digest)
            for field in h.asdict(closed):
                if field in identities:self.assertNotEqual(getattr(fresh,field),getattr(closed,field))
                else:self.assertEqual(getattr(fresh,field),getattr(closed,field))
            self.assertFalse(set(fresh.learners).intersection(closed.learners))
            for field in identities:
                with self.subTest(profile=name,field=field),self.assertRaises(h.ScopeError):h.proposal(replace(fresh,**{field:getattr(closed,field)}))
        self.assertEqual(h.proposal(fresh)['status'],'proposed_not_authorized')

    def test_attempt003_keeps_immutable_owner_binding_and_approved_ten_minute_guard(self):
        fresh=h.plan_for('attempt003')
        # These are deterministic 1970 fake inputs, never operational approval.
        owner=h.OwnerApproval('Sentinel_'+'3'*32,'1970-01-01T00:16:40Z',h.scope_digest(fresh))
        receipt=h.approval_receipt(owner,fresh,1000)
        with self.assertRaises(h.ScopeError):h.exercise_injected(self.f,self.approval,lambda:1000,fresh,owner_approval=self.owner)
        self.assertEqual(self.f.events,[])
        self.f.proof.update(database=fresh.database,project=fresh.project)
        h.validate_owner_approval(receipt,owner,1600,fresh)
        expired=h.approval_receipt(owner,fresh,1601)
        with self.assertRaises(h.ScopeError):h.exercise_injected(self.f,expired,lambda:1601,fresh,owner_approval=owner)
        self.assertEqual(self.f.events,[])
        outcome=h.exercise_injected(self.f,receipt,lambda:1000,fresh,owner_approval=owner)
        self.assertTrue(outcome['assertions_passed']);self.assertTrue(outcome['cleanup_verified'])
        self.assertEqual(outcome['owner_approved_at_utc'],'1970-01-01T00:16:40Z')
        self.assertEqual(outcome['deadline']-outcome['started'],3600)


    def test_attempt003_v2_scope_binds_window_and_invalidates_old_receipts_before_preflight(self):
        plan=h.plan_for('attempt003');proposal=h.proposal(plan)
        self.assertEqual(proposal['scope_version'],2)
        self.assertEqual(proposal['owner_approval_max_age_seconds'],600)
        self.assertEqual(h.approval_max_age_seconds(plan),600)
        old_digest='fa9c9ff5dd44fd4627b8da3d06e76d548dc7748b94fc05c824602f74712342ad'
        self.assertNotEqual(h.scope_digest(plan),old_digest)
        self.assertEqual(h.scope_digest(plan),'2ea73394604160d80746e9c50d499b25c361ec6c430195899dfb5e18b263dfd6')
        self.assertEqual((h.approval_max_age_seconds(h.plan_for('attempt001')),h.approval_max_age_seconds(h.plan_for('attempt002'))),(60,60))
        owner=h.OwnerApproval('Sentinel_'+'1'*32,'1970-01-01T00:16:40Z',old_digest)
        raw={'message_id':owner.message_id,'approved_at_utc':owner.approved_at_utc,'scope_sha256':old_digest}
        receipt={'scope_sha256':old_digest,'confirmed_at_action_time':True,'browser_origin':'http://127.0.0.1:3151',
                 'owner_message_id':owner.message_id,'owner_approved_at_utc':owner.approved_at_utc,
                 'owner_binding_sha256':h.hashlib.sha256(h.json.dumps(raw,sort_keys=True,separators=(',',':')).encode()).hexdigest(),
                 'receipt_created_at_epoch':1000}
        for now in [1000,1059]:
            with self.subTest(now=now),self.assertRaises(h.ScopeError):h.exercise_injected(self.f,receipt,lambda:now,plan,owner_approval=owner)
        # Merely replacing the receipt's scope cannot rebind its independent owner.
        with self.assertRaises(h.ScopeError):h.exercise_injected(self.f,{**receipt,'scope_sha256':h.scope_digest(plan)},lambda:1000,plan,owner_approval=owner)
        with self.assertRaises(h.ScopeError):h.approval_receipt(owner,plan,1000)
        self.assertEqual(self.f.events,[])

    def test_attempt003_exact_six_hundred_second_microsecond_boundary_and_future_rejection(self):
        plan=h.plan_for('attempt003')
        owner=h.OwnerApproval('Sentinel_'+'2'*32,'2026-10-29T13:17:45.761136Z',h.scope_digest(plan))
        receipt=h.approval_receipt(owner,plan,owner.epoch)
        self.assertEqual(receipt['owner_approved_at_utc'],'2026-10-29T13:17:45.761136Z')
        past_legacy_boundary=owner.epoch+60.000001
        h.validate_owner_approval(receipt,owner,past_legacy_boundary,plan)
        boundary=h.datetime(2026,10,29,13,27,45,761136,tzinfo=h.timezone.utc).timestamp()
        h.validate_owner_approval(receipt,owner,boundary,plan)
        late=h.datetime(2026,10,29,13,27,45,761137,tzinfo=h.timezone.utc).timestamp()
        future=h.datetime(2026,10,29,13,17,45,761135,tzinfo=h.timezone.utc).timestamp()
        for now in [late,future]:
            with self.subTest(now=now),self.assertRaises(h.ScopeError):h.exercise_injected(self.f,receipt,lambda:now,plan,owner_approval=owner)
        regenerated=h.approval_receipt(owner,plan,late)
        with self.assertRaises(h.ScopeError):h.exercise_injected(self.f,regenerated,lambda:late,plan,owner_approval=owner)
        self.assertEqual(self.f.events,[])

    def test_attempt003_slow_preflight_rechecks_ten_minute_age_before_reservation(self):
        plan=h.plan_for('attempt003')
        owner=h.OwnerApproval('Sentinel_'+'4'*32,'1970-01-01T00:16:40Z',h.scope_digest(plan))
        receipt=h.approval_receipt(owner,plan,1000)
        for end in [1061,1600,1600.000001]:
            fake=FakeRuntime();fake.proof.update(database=plan.database,project=plan.project)
            original=fake.preflight
            def slow(p):
                proof=original(p);fake.clock=end;return proof
            fake.preflight=slow
            if end<=1600:
                result=h.exercise_injected(fake,receipt,lambda:fake.clock,plan,owner_approval=owner)
                self.assertTrue(result['assertions_passed']);self.assertTrue(result['cleanup_verified'])
                self.assertEqual(result['started'],end);self.assertEqual(result['deadline']-result['started'],3600)
            else:
                with self.assertRaises(h.ScopeError):h.exercise_injected(fake,receipt,lambda:fake.clock,plan,owner_approval=owner)
                self.assertEqual(fake.events,['preflight'])

    def test_expired_attempt003_message_cannot_be_rebound_to_v2_or_refreshed(self):
        plan=h.plan_for('attempt003');message='Sentinel_754d4f4bf350819194caab16f4119f8b'
        stamp,digest=h.CLOSED_OWNER_APPROVALS[message]
        self.assertEqual(stamp,'2026-10-29T13:17:45.761136Z')
        owner=h.OwnerApproval(message,stamp,digest)
        for change in [{'scope_sha256':h.scope_digest(plan)},{'approved_at_utc':'2026-10-29T13:51:58Z'}]:
            with self.subTest(change=change),self.assertRaises(h.ScopeError):replace(owner,**change)
        with self.assertRaises(h.ScopeError):h.validate_owner_approval({},owner,owner.epoch,plan)
        self.assertEqual(self.f.events,[])

    def test_source_only_policy_approval_cannot_authorize_runtime(self):
        plan=h.plan_for('attempt003')
        owner=h.OwnerApproval('Sentinel_6c15d89054c08191b4923a8313c5552b','2026-10-29T13:51:58Z',h.scope_digest(plan))
        receipt=h.approval_receipt(owner,plan,owner.epoch)
        with self.assertRaises(h.ScopeError):h.exercise_injected(self.f,receipt,lambda:owner.epoch,plan,owner_approval=owner)
        self.assertEqual(self.f.events,[])

    def test_profile_registry_cannot_add_or_rebind_arbitrary_targets(self):
        original=h.json.loads(h.Path(h.__file__).with_name('checkpoint-auth-profiles.json').read_text())
        for changed in [{**original,'attempt004':original['attempt003']},{**original,'attempt003':{**original['attempt003'],'directory':'/tmp/arbitrary'}}]:
            with patch.object(h.Path,'read_text',return_value=h.json.dumps(changed)),self.assertRaises(h.ScopeError):h.plan_for('attempt003')

    def test_owner_evidence_is_frozen_and_message_time_cannot_be_reassigned(self):
        with self.assertRaises(FrozenInstanceError):self.owner.approved_at_utc='1970-01-01T00:17:41Z'
        with self.assertRaises(h.ScopeError):replace(self.owner,approved_at_utc='1970-01-01T00:17:41Z')
        self.assertEqual(self.owner.approved_at_utc,'1970-01-01T00:16:40Z')
        with self.assertRaises(h.ScopeError):replace(self.owner,scope_sha256=h.scope_digest(h.plan_for('attempt002')))
        with self.assertRaises(h.ScopeError):h.approval_receipt(self.owner,h.plan_for('attempt002'),1000)

    def test_fractional_owner_time_preserves_exact_text_binding_and_microsecond_epoch(self):
        # Historical text, synthetic ID, and pure in-memory receipt only.
        stamp='2026-10-29T13:17:45.761136Z'
        owner=h.OwnerApproval('Sentinel_'+'6'*32,stamp,h.scope_digest())
        expected=h.datetime(2026,10,29,13,17,45,761136,tzinfo=h.timezone.utc)
        self.assertEqual(owner.approved_at_utc,stamp)
        self.assertEqual(owner.epoch,expected.timestamp())
        self.assertEqual(h.datetime.fromtimestamp(owner.epoch,h.timezone.utc).microsecond,761136)
        receipt=h.approval_receipt(owner,h.Plan(),owner.epoch)
        self.assertEqual(receipt['owner_approved_at_utc'],stamp)
        raw={'message_id':owner.message_id,'approved_at_utc':stamp,'scope_sha256':h.scope_digest()}
        self.assertEqual(receipt['owner_binding_sha256'],h.hashlib.sha256(h.json.dumps(raw,sort_keys=True,separators=(',',':')).encode()).hexdigest())
        with self.assertRaises(h.ScopeError):replace(owner,approved_at_utc='2026-10-29T13:17:45Z')
        with self.assertRaises(h.ScopeError):h.validate_owner_approval({**receipt,'owner_approved_at_utc':'2026-10-29T13:17:45Z'},owner,owner.epoch,h.Plan())

    def test_fractional_owner_time_keeps_exact_sixty_second_microsecond_boundary(self):
        owner=h.OwnerApproval('Sentinel_'+'7'*32,'2026-10-29T13:17:45.761136Z',h.scope_digest())
        receipt=h.approval_receipt(owner,h.Plan(),owner.epoch)
        boundary=h.datetime(2026,10,29,13,18,45,761136,tzinfo=h.timezone.utc).timestamp()
        h.validate_owner_approval(receipt,owner,boundary,h.Plan())
        late=h.datetime(2026,10,29,13,18,45,761137,tzinfo=h.timezone.utc).timestamp()
        self.assertGreater(late-boundary,0)
        with self.assertRaises(h.ScopeError):h.exercise_injected(self.f,receipt,lambda:late,owner_approval=owner)
        regenerated=h.approval_receipt(owner,h.Plan(),late)
        with self.assertRaises(h.ScopeError):h.exercise_injected(self.f,regenerated,lambda:late,owner_approval=owner)
        expired=h.datetime(2026,10,29,13,19,59,tzinfo=h.timezone.utc).timestamp()
        with self.assertRaises(h.ScopeError):h.exercise_injected(self.f,h.approval_receipt(owner,h.Plan(),expired),lambda:expired,owner_approval=owner)
        self.assertEqual(self.f.events,[])

    def test_one_through_six_fractional_digits_are_supported_without_raw_rebinding(self):
        for index,fraction in enumerate(['7','76','761','7611','76113','761136']):
            stamp='2026-10-29T13:17:45.'+fraction+'Z'
            owner=h.OwnerApproval('Sentinel_'+'8'*31+str(index),stamp,h.scope_digest())
            self.assertEqual(owner.approved_at_utc,stamp)
            self.assertEqual(h.datetime.fromtimestamp(owner.epoch,h.timezone.utc).microsecond,int(fraction.ljust(6,'0')))
        owner=h.OwnerApproval('Sentinel_'+'9'*32,'2026-10-29T13:17:45.700000Z',h.scope_digest())
        with self.assertRaises(h.ScopeError):replace(owner,approved_at_utc='2026-10-29T13:17:45.7Z')
        closed_id,(closed_stamp,closed_scope)=next(iter(h.CLOSED_OWNER_APPROVALS.items()))
        with self.assertRaises(h.ScopeError):h.OwnerApproval(closed_id,closed_stamp[:-1]+'.000000Z',closed_scope)
        self.assertEqual(h.CLOSED_OWNER_APPROVALS[closed_id],(closed_stamp,closed_scope))

    def test_malformed_or_excess_precision_fractional_owner_time_fails_closed(self):
        for suffix in ['.Z','.1234567Z','.0000000Z','.1.2Z',',761136Z','.761136+00:00','.761136z',' .761136Z','.76113aZ']:
            with self.subTest(suffix=suffix),self.assertRaises(h.ScopeError):
                h.OwnerApproval('Sentinel_'+'0'*32,'2026-10-29T13:17:45'+suffix,h.scope_digest())
        self.assertEqual(self.f.events,[])

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


    def test_completed_attempt003_grant_is_closed_after_verified_cleanup(self):
        plan=h.plan_for('attempt003')
        message='Sentinel_86aebfe913e48191b51fc427a33efe78'
        stamp,digest=h.CLOSED_OWNER_APPROVALS[message]
        owner=h.OwnerApproval(message,stamp,digest)
        receipt=h.approval_receipt(owner,plan,owner.epoch)
        with self.assertRaises(h.ScopeError):h.exercise_injected(self.f,receipt,lambda:owner.epoch,plan,owner_approval=owner)
        with self.assertRaises(h.ScopeError):replace(owner,approved_at_utc='2026-10-29T15:29:54.174524Z')
        self.assertEqual(self.f.events,[])


if __name__=='__main__':unittest.main()
