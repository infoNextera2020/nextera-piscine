from dataclasses import replace
import json
import unittest

from capture import AttemptBinding, ExecutionCapture, evaluate_capture, sha256
from oracle import expected_projection


class FakeHostPort:
    """Synthetic port only. This is not a configured Runner or authenticated producer."""
    def __init__(self, record):
        self.record = record
        self.calls = []

    def read(self, attempt_id, capture_id):
        self.calls.append((attempt_id, capture_id))
        return self.record


def fixture():
    source, stdin = b'fixture source; never executed', b'0427\n2\n25\n1\n4'
    binding = AttemptBinding('synthetic-attempt', sha256(source), sha256(stdin), 'c'*64, 'e'*64)
    stdout = ('\n'.join(json.dumps(e) for e in expected_projection(stdin))+'\n').encode()
    record = ExecutionCapture('synthetic-capture', binding, source, stdin, stdout,
                              b'Human wording is not used as business evidence.', True, True, 'exited', 0)
    return binding, record


def evaluate(port, binding):
    return evaluate_capture(port, binding, 'synthetic-capture', host_contract_sha256='c'*64,
                            host_resource_policy_sha256='e'*64)


class TrustedCaptureSourceContract(unittest.TestCase):
    def test_no_producer_is_unavailable_not_a_pass(self):
        binding, _ = fixture()
        self.assertEqual(evaluate(None, binding).kind, 'capture_unavailable')

    def test_learner_json_or_verified_flag_cannot_become_a_capture(self):
        binding, _ = fixture()
        claimed = {'verified': True, 'passed': True, 'exit_code': 0, 'source_sha256': binding.source_sha256}
        self.assertEqual(evaluate(FakeHostPort(claimed), binding).kind, 'capture_unavailable')

    def test_complete_bound_fake_capture_reaches_only_observation_comparison(self):
        binding, record = fixture()
        port = FakeHostPort(record)
        result = evaluate(port, binding)
        self.assertEqual(result.kind, 'observations_match')
        self.assertIn('not an academic PASS', result.detail)
        self.assertEqual(port.calls, [('synthetic-attempt', 'synthetic-capture')])

    def test_exact_attempt_capture_source_input_contract_and_resource_are_required(self):
        binding, record = fixture()
        changes = (replace(record, capture_id='another'),
                   replace(record, binding=replace(binding, attempt_id='another-attempt')),
                   replace(record, binding=replace(binding, reporting_contract_sha256='d'*64)),
                   replace(record, binding=replace(binding, resource_policy_sha256='f'*64)),
                   replace(record, executed_source=b'another immutable file'),
                   replace(record, delivered_stdin=b'0427\n1\n4'))
        for changed in changes:
            with self.subTest(changed=changed):
                self.assertEqual(evaluate(FakeHostPort(changed), binding).kind, 'capture_binding_mismatch')

    def test_host_policy_change_fails_before_read(self):
        binding, record = fixture()
        port = FakeHostPort(record)
        result = evaluate_capture(port, binding, record.capture_id, host_contract_sha256='d'*64,
                                  host_resource_policy_sha256='e'*64)
        self.assertEqual(result.kind, 'capture_binding_mismatch')
        self.assertEqual(port.calls, [])

    def test_missing_policy_is_not_filled_by_default(self):
        binding, record = fixture()
        self.assertEqual(evaluate(FakeHostPort(record), replace(binding, resource_policy_sha256='')).kind,
                         'capture_binding_invalid')

    def test_incomplete_io_or_interrupted_process_does_not_become_business_pass(self):
        binding, record = fixture()
        changes = (replace(record, input_delivery_complete=False),
                   replace(record, output_capture_complete=False),
                   replace(record, termination='unknown'), replace(record, termination='timed_out'),
                   replace(record, termination='signalled'), replace(record, exit_code=None))
        for changed in changes:
            with self.subTest(changed=changed):
                self.assertEqual(evaluate(FakeHostPort(changed), binding).kind, 'incomplete_observation')

    def test_correct_json_followed_by_nonzero_helper_exit_is_not_a_match(self):
        binding, record = fixture()
        self.assertEqual(evaluate(FakeHostPort(replace(record, exit_code=2)), binding).kind, 'execution_not_clean')
        self.assertEqual(evaluate(FakeHostPort(replace(record, exit_code=True)), binding).kind, 'incomplete_observation')

    def test_stderr_and_readme_claims_are_not_an_oracle(self):
        binding, record = fixture()
        changed = replace(record, stdout=b'{"passed":true,"balance":125}\n',
                          stderr=b'All tests passed; process exited; mentor approved.')
        self.assertEqual(evaluate(FakeHostPort(changed), binding).kind, 'projection_mismatch')

    def test_wrong_structurally_valid_report_is_checked_against_input_model(self):
        binding, record = fixture()
        changed = replace(record, stdout=record.stdout.replace(b'"balance", 125', b'"balance", 999'))
        self.assertEqual(evaluate(FakeHostPort(changed), binding).kind, 'projection_mismatch')

    def test_port_failure_stays_unavailable(self):
        binding, _ = fixture()
        class BrokenPort:
            def read(self, *_):
                raise OSError('synthetic capture storage unavailable')
        self.assertEqual(evaluate(BrokenPort(), binding).kind, 'capture_unavailable')


if __name__ == '__main__':
    unittest.main()
