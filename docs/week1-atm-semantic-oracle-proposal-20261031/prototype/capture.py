"""Pure source seam. No production trusted capture producer is configured here.

Only a future host-owned authenticated capture port may provide ExecutionCapture.
Shape/digest validation does not authenticate a receipt received from a learner.
"""
from dataclasses import dataclass
import hashlib
import re
from typing import Protocol

from oracle import APPROVED_REPORTING_CONTRACT, Comparison, compare


@dataclass(frozen=True)
class AttemptBinding:
    attempt_id: str
    source_sha256: str
    stdin_sha256: str
    reporting_contract_sha256: str
    resource_policy_sha256: str


@dataclass(frozen=True)
class ExecutionCapture:
    capture_id: str
    binding: AttemptBinding
    executed_source: bytes
    delivered_stdin: bytes
    stdout: bytes
    stderr: bytes
    input_delivery_complete: bool
    output_capture_complete: bool
    termination: str  # exited/signalled/timed_out/unknown, reported by host capture only.
    exit_code: int | None


class TrustedCapturePort(Protocol):
    """Host-only dependency; no implementation or learner-supplied receipt endpoint exists."""
    def read(self, attempt_id: str, capture_id: str) -> ExecutionCapture | None:
        ...


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def evaluate_capture(port: TrustedCapturePort | None, expected: AttemptBinding,
                     capture_id: str, *, host_contract_sha256: str,
                     host_resource_policy_sha256: str) -> Comparison:
    """No grade mutation; model comparison is unreachable without a host capture port."""
    if type(expected) is not AttemptBinding:
        return Comparison('capture_binding_invalid', 'Host-resolved immutable attempt binding required.')
    hashes = (expected.source_sha256, expected.stdin_sha256,
              expected.reporting_contract_sha256, expected.resource_policy_sha256,
              host_contract_sha256, host_resource_policy_sha256)
    if (type(expected.attempt_id) is not str or not expected.attempt_id or
            type(capture_id) is not str or not capture_id or
            any(type(value) is not str or not re.fullmatch('[0-9a-f]{64}', value) for value in hashes)):
        return Comparison('capture_binding_invalid', 'Exact source/input/contract/resource bindings are required.')
    if (expected.reporting_contract_sha256 != host_contract_sha256 or
            expected.resource_policy_sha256 != host_resource_policy_sha256):
        return Comparison('capture_binding_mismatch', 'Host contract or required resource policy changed.')
    if port is None:
        return Comparison('capture_unavailable', 'No trusted producer is configured; output assertions are not evidence.')
    try:
        captured = port.read(expected.attempt_id, capture_id)
    except Exception:
        return Comparison('capture_unavailable', 'Trusted capture retrieval did not complete.')
    if type(captured) is not ExecutionCapture:
        return Comparison('capture_unavailable', 'Host capture is absent; learner JSON is not a capture receipt.')
    if captured.capture_id != capture_id or captured.binding != expected:
        return Comparison('capture_binding_mismatch', 'Capture belongs to another immutable attempt or source context.')
    if any(type(data) is not bytes for data in (captured.executed_source, captured.delivered_stdin,
                                               captured.stdout, captured.stderr)):
        return Comparison('capture_binding_invalid', 'Raw host-captured bytes are required.')
    if (sha256(captured.executed_source) != expected.source_sha256 or
            sha256(captured.delivered_stdin) != expected.stdin_sha256):
        return Comparison('capture_binding_mismatch', 'Executed source or delivered input differs from the bound bytes.')
    if captured.input_delivery_complete is not True or captured.output_capture_complete is not True:
        return Comparison('incomplete_observation', 'Input/output delivery is incomplete; do not infer a learner result.')
    if captured.termination != 'exited' or type(captured.exit_code) is not int:
        return Comparison('incomplete_observation', 'Host termination is unknown or interrupted.')
    if captured.exit_code != 0:
        return Comparison('execution_not_clean', 'Nonzero host exit cannot become a matching assessment.')
    return compare(captured.delivered_stdin, captured.stdout, contract=APPROVED_REPORTING_CONTRACT,
                   process_terminated=True)
