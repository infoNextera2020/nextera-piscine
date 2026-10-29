"""Preparation and injected lifecycle only; no Docker, SQL, HTTP or credential adapter.

Running this file prints a non-secret proposal. It cannot provision anything.
Runtime implementation and fresh action-time authorization are separate gates.
"""
from dataclasses import asdict, dataclass, replace
from pathlib import Path
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
    stems = {'attempt001': '20261028', 'attempt002': '20261029-attempt002'}
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
    for profile in ['attempt001', 'attempt002']:
        if plan == plan_for(profile):
            return profile
    raise ScopeError('Scope changed; review a new proposal before runtime approval.')


def proposal(plan=Plan()):
    profile_for_plan(plan)
    return {'status': 'proposed_not_authorized', 'plan': asdict(plan),
            'gates': ['pinned_images_and_template_verified', 'fresh_resources',
                      'permitted_authenticated_browser_target', 'new_action_time_approval',
                      'independent_deadline_and_parent_loss_guard', 'real_runtime_adapter_review'],
            'excluded': ['public_run', 'official_submit', 'invitations', 'mentor_awards',
                         'retained_databases', 'new_installs', 'security_setting_changes'],
            'deadline_coverage': 'Legacy attempt is 90 minutes; the one-hour stack cannot wait for its natural expiry. No deadline rewrite or full browser expiry claim.'}


def scope_digest(plan=Plan()):
    return hashlib.sha256(json.dumps(proposal(plan), sort_keys=True, separators=(',', ':')).encode()).hexdigest()


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


def exercise_injected(runtime, approval, now, plan=Plan()):
    """Fake-testable contract. The optional sibling runtime requires fresh exact approval; no implicit enable switch.

    Adapter obligations: persist the journal atomically/protected, reserve fresh targets
    exclusively, independently enforce expiry/parent loss, and retain evidence on failure.
    Never return secrets through these methods or include them in exceptions/reports.
    """
    if approval.get('scope_sha256') != scope_digest(plan) or approval.get('confirmed_at_action_time') is not True:
        raise ScopeError('Fresh exact-scope approval is missing.')
    approved_at = approval.get('utc_epoch')
    if type(approved_at) not in (int, float) or not 0 <= now() - approved_at <= 60:
        raise ScopeError('Approval is expired or from the future.')
    proof = runtime.preflight(plan)
    validate_preflight(proof, plan)
    started = now()
    deadline = started + plan.maximum_seconds
    outcome = {'scope_sha256': scope_digest(plan), 'started': started,
               'deadline': deadline, 'assertions_passed': False,
               'cleanup_verified': False, 'runtime_kind': runtime.kind}
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
