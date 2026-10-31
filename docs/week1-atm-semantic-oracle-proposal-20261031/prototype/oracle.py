"""Inactive developer prototype. Never executes, rewrites, grades or trusts learner code.

Compares records under the owner-approved Report source contract.
No immutable ATM pack or trusted capture producer is registered by this module.
"""
from dataclasses import dataclass
import json

CURRENT_BRIEF_SHA256 = '8d8ff72fdbc241e0c7fdcfe1692cef8223ee426ca68d373f004f63cf15f28a1b'
APPROVED_REPORTING_CONTRACT = 'atm-observable-report-v1'
# Retained test alias; no runtime feature switch.
CANDIDATE_CONTRACT = APPROVED_REPORTING_CONTRACT
KINDS = frozenset(('menu', 'amount', 'balance', 'accepted', 'rejected', 'end'))


class OutsideInputContract(ValueError):
    pass


@dataclass(frozen=True)
class Comparison:
    kind: str
    detail: str
    expected: tuple = ()
    observed: tuple = ()


def scan_lines(data: bytes) -> tuple[bytes, ...]:
    """Go ScanLines-compatible assessed input splitting; no input whitespace trim."""
    if type(data) is not bytes:
        raise TypeError('exact stdin bytes required')
    lines = data.split(b'\n')
    if lines[-1] == b'':
        lines.pop()
    made = tuple(line[:-1] if line.endswith(b'\r') else line for line in lines)
    for line in made:
        try:
            text = line.decode('utf-8', errors='strict')
        except UnicodeDecodeError as exc:
            raise OutsideInputContract('invalid UTF-8 is unspecified by the source brief') from exc
        if len(text) > 20:
            raise OutsideInputContract('assessed lines above 20 characters are outside this proposal')
    return made


def expected_projection(stdin: bytes) -> tuple[tuple[str, int | None], ...]:
    """Reference facts from the pinned brief, not parsed from learner assertions."""
    lines = scan_lines(stdin)
    balance, failures, phase = 100, 0, 'pin'
    events = []
    authenticated = False
    for line in lines:
        if phase == 'end':
            break  # An exited program never consumes the remaining supplied stream.
        if phase == 'pin':
            if line == b'0427':
                authenticated, phase = True, 'menu'
                events.append(('menu', balance))
            else:
                failures += 1
                events.append(('rejected', None))
                if failures == 3:
                    phase = 'end'
                    events.append(('end', None))
            continue
        if phase == 'menu':
            if line == b'4':
                phase = 'end'
                events.append(('end', balance))
            elif line == b'1':
                events.extend((('balance', balance), ('menu', balance)))
            elif line in (b'2', b'3'):
                phase = 'deposit' if line == b'2' else 'withdraw'
                events.append(('amount', balance))
            else:
                events.extend((('rejected', balance), ('menu', balance)))
            continue
        valid_text = 1 <= len(line) <= 5 and all(48 <= ch <= 57 for ch in line)
        amount = int(line) if valid_text else None
        allowed = amount is not None and 1 <= amount <= 1000
        if allowed and phase == 'deposit':
            allowed = balance + amount <= 10000
        elif allowed and phase == 'withdraw':
            allowed = amount <= balance
        if allowed:
            balance = balance + amount if phase == 'deposit' else balance - amount
            events.append(('accepted', balance))
        else:
            events.append(('rejected', balance))
        phase = 'menu'
        events.append(('menu', balance))
    if phase != 'end':
        events.append(('end', balance if authenticated else None))
    return tuple(events)


def parse_candidate_output(stdout: bytes) -> tuple[tuple[str, int | None], ...]:
    """Strict whole-record framing, no word inference, number scraping or code rewriting."""
    if type(stdout) is not bytes:
        raise ValueError('captured stdout bytes required')
    def reject_nonfinite(_):
        raise ValueError('nonfinite')

    text = stdout.decode('utf-8', errors='strict')
    events = []
    for line in text.split('\n'):
        if not line.strip(' \t\r'):
            continue
        item = json.loads(line, parse_constant=reject_nonfinite)
        if type(item) is not list or len(item) != 2 or type(item[0]) is not str or item[0] not in KINDS:
            raise ValueError('one exact [kind,balance] record per line required')
        kind, balance = item
        if balance is not None and (type(balance) is not int or not 0 <= balance <= 10000):
            raise ValueError('integer invented units required')
        if kind not in ('rejected', 'end') and balance is None:
            raise ValueError('authenticated observation needs a balance')
        events.append((kind, balance))
    return tuple(events)


def compare(stdin: bytes, stdout: bytes, *, contract: str | None = None,
            process_terminated: bool | None = None) -> Comparison:
    # This is a specification selector in an isolated test prototype, not a production flag.
    if contract != CANDIDATE_CONTRACT:
        return Comparison('unresolved_contract', 'Exact owner-approved Report contract has not been selected; no result is inferred.')
    if process_terminated is not True:
        return Comparison('incomplete_observation', 'No independently captured process termination is available.')
    try:
        expected = expected_projection(stdin)
    except OutsideInputContract as exc:
        return Comparison('outside_assessed_input', str(exc))
    try:
        observed = parse_candidate_output(stdout)
    except (ValueError, UnicodeError) as exc:
        return Comparison('projection_mismatch', str(exc), expected)
    if observed != expected:
        return Comparison('projection_mismatch', 'Captured facts differ from the independent model.', expected, observed)
    return Comparison('observations_match', 'Approved-source observable trace matches; this is not an academic PASS.', expected, observed)
