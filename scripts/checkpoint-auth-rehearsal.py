"""Preparation and injected lifecycle only; no Docker, SQL, HTTP or credential adapter.

Running this file prints a non-secret proposal. It cannot provision anything.
Runtime implementation and fresh action-time authorization are separate gates.
"""
from dataclasses import asdict, dataclass, replace
from pathlib import Path
from datetime import datetime, timezone
from types import MappingProxyType
import re
import hashlib
import json


class ScopeError(ValueError):
    pass


@dataclass(frozen=True)
class Plan:
    project: str = '01coding-checkpoint-browser-20261028'
    directory: str = '/home/anas/.local/share/nextera-judge/checkpoint-browser-20261028/run-001'
    database: str = 'foundation_test_checkpoint_browser_20261028'
    bindings: tuple = (('gateway', '127.0.0.1', 56531), ('db', '127.0.0.1', 56532), ('app', '127.0.0.1', 3151))
    services: tuple = ('db', 'auth', 'rest', 'storage', 'imgproxy', 'meta', 'studio', 'api-gw')
    migrations: tuple = tuple(f'{n:04d}' for n in range(11)) + ('0011', '0014')
    learners: tuple = ('checkpoint-a-20261028@example.invalid', 'checkpoint-b-20261028@example.invalid')
    login_role: str = 'checkpoint_browser_web_20261028'
    role_memberships: tuple = ('nextera_web',)
    maximum_seconds: int = 3600
    auth_jwt_seconds: int = 300
    checkpoint_seconds: int = 5400
    draft_source_bytes: int = 1024
    draft_receipts: int = 64
    draft_total_source_bytes: int = 65536
    draft_retention_seconds: int = 600
    cleanup_authentication: str = 'existing_test_accounts_inside_original_window_only'
    offline_recovery: bool = False
    retain_evidence_and_data: bool = True
    upstream_commit: str = 'bc27d2661edd09a5d0b8d76ce33da6d4071a756e'


def plan_for(profile='attempt001'):
    stems = {'attempt001': '20261028', 'attempt002': '20261029-attempt002', 'attempt003': '20261029-attempt003'}
    if profile not in stems:
        raise ScopeError('Unknown closed rehearsal profile.')
    rows = json.loads(Path(__file__).with_name('checkpoint-auth-profiles.json').read_text())
    if set(rows) != set(stems):
        raise ScopeError('Profile registry changed; review source before approval.')
    stem = stems[profile]; token = stem.replace('-', '_')
    expected = {'project': '01coding-checkpoint-browser-' + stem,
                'directory': '/home/anas/.local/share/nextera-judge/checkpoint-browser-' + stem + '/run-001',
                'database': 'foundation_test_checkpoint_browser_' + token,
                'learners': ['checkpoint-a-' + stem + '@example.invalid', 'checkpoint-b-' + stem + '@example.invalid'],
                'login_role': 'checkpoint_browser_web_' + token}
    if rows[profile] != expected:
        raise ScopeError('Profile identity mismatch; arbitrary targets are forbidden.')
    return replace(Plan(), **{**expected, 'learners': tuple(expected['learners'])})


def profile_for_plan(plan):
    for profile in ['attempt001', 'attempt002', 'attempt003']:
        if plan == plan_for(profile):
            return profile
    raise ScopeError('Scope changed; review a new proposal before runtime approval.')


ATTEMPT003_APPROVAL_MAX_AGE_SECONDS = 600


def approval_max_age_seconds(plan):
    # Closed historical profiles retain their original policy and scope digests.
    return ATTEMPT003_APPROVAL_MAX_AGE_SECONDS if profile_for_plan(plan) == 'attempt003' else 60


def proposal(plan=Plan()):
    profile_for_plan(plan)
    policy = {'scope_version': 2, 'owner_approval_max_age_seconds': approval_max_age_seconds(plan)} if profile_for_plan(plan) == 'attempt003' else {}
    return {**policy, 'status': 'proposed_not_authorized', 'plan': asdict(plan),
            'gates': ['pinned_images_and_template_verified', 'fresh_resources',
                      'permitted_authenticated_browser_target', 'new_action_time_approval',
                      'independent_deadline_and_parent_loss_guard', 'real_runtime_adapter_review'],
            'excluded': ['public_run', 'official_submit', 'invitations', 'mentor_awards',
                         'retained_databases', 'new_installs', 'security_setting_changes'],
            'deadline_coverage': 'Legacy attempt is 90 minutes; the one-hour stack cannot wait for its natural expiry. No deadline rewrite or full browser expiry claim.'}


def scope_digest(plan=Plan()):
    return hashlib.sha256(json.dumps(proposal(plan), sort_keys=True, separators=(',', ':')).encode()).hexdigest()


# The incident's real message/time binding is retained permanently in source.
# A closed grant cannot be relabeled as a new action-time approval.
CLOSED_OWNER_APPROVALS = MappingProxyType({
    'Sentinel_7b5ec1bcc1cc819187d19f16ccc96f4a': ('2026-10-29T09:17:11Z', 'a267f057515c96963d1c44ae2125f68b41521c822ec62fc7be48c36507724b72'),
    'Sentinel_754d4f4bf350819194caab16f4119f8b': ('2026-10-29T13:17:45.761136Z', 'fa9c9ff5dd44fd4627b8da3d06e76d548dc7748b94fc05c824602f74712342ad'),
})
# This message approved source-policy changes only, never a runtime launch.
SOURCE_ONLY_OWNER_MESSAGES = frozenset({'Sentinel_6c15d89054c08191b4923a8313c5552b'})
_OWNER_BINDINGS = dict(CLOSED_OWNER_APPROVALS)


@dataclass(frozen=True)
class OwnerApproval:
    message_id: str
    approved_at_utc: str
    scope_sha256: str

    def __post_init__(self):
        if not isinstance(self.message_id, str) or not re.fullmatch(r'Sentinel_[0-9a-f]{32}', self.message_id):
            raise ScopeError('Exact owner message ID is required.')
        if not isinstance(self.approved_at_utc, str) or not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?Z', self.approved_at_utc):
            raise ScopeError('Exact owner UTC timestamp is required; no current-time default.')
        try:
            datetime.strptime(self.approved_at_utc, '%Y-%m-%dT%H:%M:%S.%fZ' if '.' in self.approved_at_utc else '%Y-%m-%dT%H:%M:%SZ')
        except ValueError as error:
            raise ScopeError('Invalid owner timestamp.') from error
        if not isinstance(self.scope_sha256, str) or not re.fullmatch(r'[0-9a-f]{64}', self.scope_sha256):
            raise ScopeError('Exact owner-approved scope digest is required.')
        binding = (self.approved_at_utc, self.scope_sha256)
        bound = _OWNER_BINDINGS.setdefault(self.message_id, binding)
        if bound != binding:
            raise ScopeError('Owner message timestamp/scope cannot be reassigned.')

    @property
    def epoch(self):
        return datetime.strptime(self.approved_at_utc, '%Y-%m-%dT%H:%M:%S.%fZ' if '.' in self.approved_at_utc else '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc).timestamp()

    def binding_digest(self, plan):
        if self.scope_sha256 != scope_digest(plan):
            raise ScopeError('Owner evidence is bound to a different approved scope.')
        value = {'message_id': self.message_id, 'approved_at_utc': self.approved_at_utc, 'scope_sha256': scope_digest(plan)}
        return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def approval_receipt(owner, plan, receipt_created_at_epoch):
    """Pure audit structure. The creation time never supplies/renews owner time."""
    if not isinstance(owner, OwnerApproval):
        raise ScopeError('Immutable owner evidence must be supplied separately.')
    return {'scope_sha256': scope_digest(plan), 'confirmed_at_action_time': True, 'browser_origin': 'http://127.0.0.1:3151',
            'owner_message_id': owner.message_id, 'owner_approved_at_utc': owner.approved_at_utc,
            'owner_binding_sha256': owner.binding_digest(plan),
            'receipt_created_at_epoch': receipt_created_at_epoch}


def validate_owner_approval(receipt, owner, observed_at, plan):
    if not isinstance(owner, OwnerApproval):
        raise ScopeError('Immutable owner message/time input is required separately from the receipt.')
    if owner.message_id in SOURCE_ONLY_OWNER_MESSAGES:
        raise ScopeError('Source-policy approval is not runtime launch approval.')
    if owner.message_id in CLOSED_OWNER_APPROVALS:
        raise ScopeError('Closed owner approval cannot be reused; new owner approval is required.')
    if receipt.get('browser_origin') != 'http://127.0.0.1:3151':
        raise ScopeError('Exact approved browser origin is required.')
    if 'utc_epoch' in receipt:
        raise ScopeError('Legacy receipt timestamp is not owner approval evidence.')
    if (receipt.get('scope_sha256') != scope_digest(plan) or receipt.get('confirmed_at_action_time') is not True or
        receipt.get('owner_message_id') != owner.message_id or receipt.get('owner_approved_at_utc') != owner.approved_at_utc or
        receipt.get('owner_binding_sha256') != owner.binding_digest(plan)):
        raise ScopeError('Receipt does not match exact immutable owner message/time and scope.')
    created = receipt.get('receipt_created_at_epoch')
    if type(created) not in (int, float) or not owner.epoch <= created <= observed_at:
        raise ScopeError('Invalid receipt creation audit time.')
    if not 0 <= observed_at - owner.epoch <= approval_max_age_seconds(plan):
        raise ScopeError('Owner approval is expired or from the future; receipt creation cannot renew it.')


def validate_preflight(proof, plan=Plan()):
    proposal(plan)
    required = {'fresh_directory', 'fresh_project', 'fresh_volumes', 'ports_available',
                'pinned_images_available', 'template_digest_verified',
                'browser_target_permitted', 'cleanup_supported'}
    if any(proof.get(k) is not True for k in required):
        raise ScopeError('Preflight incomplete; no resources or credentials may be created.')
    if proof.get('database') != plan.database or proof.get('project') != plan.project:
        raise ScopeError('Wrong target.')
    if proof.get('migrations') != list(plan.migrations):
        raise ScopeError('Migration scope mismatch.')
    if proof.get('bindings') != [list(b) for b in plan.bindings]:
        raise ScopeError('Network scope mismatch.')
    if proof.get('role_memberships') != list(plan.role_memberships):
        raise ScopeError('Role scope mismatch.')
    if proof.get('services') != list(plan.services):
        raise ScopeError('Service scope mismatch.')


def exercise_injected(runtime, approval, now, plan=Plan(), *, owner_approval=None):
    """Fake-testable contract. The optional sibling runtime requires fresh exact approval; no implicit enable switch.

    Adapter obligations: persist the journal atomically/protected, reserve fresh targets
    exclusively, independently enforce expiry/parent loss, and retain evidence on failure.
    Never return secrets through these methods or include them in exceptions/reports.
    """
    validate_owner_approval(approval, owner_approval, now(), plan)
    proof = runtime.preflight(plan)
    validate_preflight(proof, plan)
    # Preflight may be slow. Recheck the real owner time immediately before reservation.
    validate_owner_approval(approval, owner_approval, now(), plan)
    started = now()
    deadline = started + plan.maximum_seconds
    outcome = {'scope_sha256': scope_digest(plan), 'started': started,
               'deadline': deadline, 'assertions_passed': False,
               'cleanup_verified': False, 'runtime_kind': runtime.kind,
               'owner_message_id': owner_approval.message_id, 'owner_approved_at_utc': owner_approval.approved_at_utc,
               'owner_approved_scope_sha256': owner_approval.scope_sha256,
               'receipt_created_at_epoch': approval['receipt_created_at_epoch']}
    # Exclusive reservation and its no-reuse journal precede all mutations. An adapter
    # that cannot journal uncertain outcomes must refuse before creating a resource.
    reservation = runtime.reserve_fresh(plan, outcome)
    try:
        guard = runtime.arm_guard(reservation, deadline, parent_loss=True, retain=True)
        if guard != {'deadline': deadline, 'independent': True, 'parent_loss': True}:
            raise ScopeError('Guard not verified.')
        for phase in ['stage', 'start', 'apply_scoped_sql', 'issue_restricted_access', 'assert_http_and_browser']:
            if now() >= deadline:
                raise ScopeError('Window expired; no renewal.')
            runtime.phase(phase, reservation, plan, deadline)
            runtime.journal(reservation, phase)
        if now() >= deadline:
            raise ScopeError('Window expired before final assertion receipt.')
        outcome['assertions_passed'] = True
    except Exception:
        # Do not serialize provider errors: they may contain DSNs, keys or source.
        outcome['failure'] = 'phase_failed_or_window_expired'
    finally:
        # Cleanup includes uncertain/partial starts and is adapter-idempotent. It must
        # disable only scoped access before stopping only identity-verified resources.
        try:
            runtime.revoke_and_stop(reservation, plan, retain=True)
            outcome['cleanup_verified'] = runtime.verify_stopped(reservation, plan) is True
        except Exception:
            outcome['cleanup_verified'] = False
        if not outcome['cleanup_verified']:
            outcome['failure'] = 'cleanup_unverified_do_not_restart'
        runtime.journal(reservation, outcome)
    return outcome


if __name__ == '__main__':
    print(json.dumps(proposal(), indent=2))
