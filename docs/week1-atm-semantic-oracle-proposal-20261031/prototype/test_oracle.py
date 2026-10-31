import json
import hashlib
from pathlib import Path
import unittest

from oracle import (CANDIDATE_CONTRACT, CURRENT_BRIEF_SHA256, compare, expected_projection,
                    parse_candidate_output, scan_lines)


def emit(events):
    return ('\n'.join(json.dumps(event, separators=(',', ':')) for event in events)+'\n').encode()


class SourceFacts(unittest.TestCase):
    def test_pinned_source(self):
        self.assertEqual(CURRENT_BRIEF_SHA256,
                         '8d8ff72fdbc241e0c7fdcfe1692cef8223ee426ca68d373f004f63cf15f28a1b')
        source = Path(__file__).resolve().parents[3] / 'content/source-baselines/project1-atm-v1/learner-en.md'
        self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(), CURRENT_BRIEF_SHA256)

    def test_helper_whole_lines_not_trimmed(self):
        self.assertEqual(scan_lines(b''), ())
        self.assertEqual(scan_lines(b'\n'), (b'',))
        self.assertEqual(scan_lines(b' 42 \r\n0427\n4'), (b' 42 ', b'0427', b'4'))
        self.assertEqual(scan_lines(b'\r'), (b'',))

    def test_short_journey(self):
        self.assertEqual(expected_projection(b'0427\n1\n2\n25\n3\n40\n1\n4\n'), (
            ('menu', 100), ('balance', 100), ('menu', 100), ('amount', 100),
            ('accepted', 125), ('menu', 125), ('amount', 125), ('accepted', 85),
            ('menu', 85), ('balance', 85), ('menu', 85), ('end', 85)))

    def test_each_exact_pin_variant_and_failed_limit(self):
        for line in (b'427', b' 0427', b'0427 ', b'', b'xxxx', '٠٤٢٧'.encode()):
            with self.subTest(line=line):
                self.assertEqual(expected_projection(line+b'\n0427\n4'),
                                 (('rejected', None), ('menu', 100), ('end', 100)))
        self.assertEqual(expected_projection(b'bad\n\nbad\n0427\n1\n4'),
                         (('rejected', None), ('rejected', None), ('rejected', None), ('end', None)))

    def test_each_menu_choice_is_exact_and_nonmutating(self):
        for line in (b'01', b' 1', b'1 ', b'9', b'', b'+1'):
            with self.subTest(line=line):
                self.assertEqual(expected_projection(b'0427\n'+line+b'\n1\n4'),
                                 (('menu', 100), ('rejected', 100), ('menu', 100),
                                  ('balance', 100), ('menu', 100), ('end', 100)))

    def test_amount_parser_and_range_rejections(self):
        invalid = (b'', b'-1', b'+1', b'1.5', b' 25', b'25 ', b'25x', '٢٥'.encode(),
                   b'000001', b'0', b'1001', b'10000', b'\x0025', b'9'*20)
        for line in invalid:
            with self.subTest(line=line):
                self.assertEqual(expected_projection(b'0427\n2\n'+line+b'\n1\n4'),
                                 (('menu', 100), ('amount', 100), ('rejected', 100),
                                  ('menu', 100), ('balance', 100), ('menu', 100), ('end', 100)))

    def test_allowed_amount_boundaries_and_leading_zeros(self):
        for amount, balance in ((b'1', 101), (b'1000', 1100), (b'00025', 125)):
            with self.subTest(amount=amount):
                self.assertEqual(expected_projection(b'0427\n2\n'+amount+b'\n1\n4')[-3:],
                                 (('balance', balance), ('menu', balance), ('end', balance)))

    def test_withdraw_to_zero_and_insufficient_funds(self):
        self.assertEqual(expected_projection(b'0427\n3\n100\n1\n4')[-3:],
                         (('balance', 0), ('menu', 0), ('end', 0)))
        self.assertIn(('rejected', 100), expected_projection(b'0427\n3\n101\n1\n4'))

    def test_cap_whole_rejection_not_clamp(self):
        setup = b'0427\n'+b'2\n1000\n'*9+b'2\n400\n'
        self.assertEqual(expected_projection(setup+b'2\n500\n1\n4')[-3:],
                         (('balance', 10000), ('menu', 10000), ('end', 10000)))
        rejected = expected_projection(setup+b'2\n501\n1\n4')
        self.assertIn(('rejected', 9500), rejected)
        self.assertEqual(rejected[-3:], (('balance', 9500), ('menu', 9500), ('end', 9500)))

    def test_rejection_keeps_earlier_work(self):
        self.assertEqual(expected_projection(b'0427\n2\n25\n2\nbad\n3\n40\n1\n4')[-3:],
                         (('balance', 85), ('menu', 85), ('end', 85)))

    def test_eof_at_every_prompt_and_after_success(self):
        cases = ((b'', ('end', None)), (b'bad\n', ('end', None)),
                 (b'0427\n', ('end', 100)), (b'0427\n2\n', ('end', 100)),
                 (b'0427\n3\n', ('end', 100)), (b'0427\n2\n25\n3\n', ('end', 125)))
        for stdin, terminal in cases:
            with self.subTest(stdin=stdin):
                self.assertEqual(expected_projection(stdin)[-1], terminal)

    def test_independent_run_resets_only_at_start(self):
        self.assertEqual(expected_projection(b'0427\n2\n900\n4')[-1], ('end', 1000))
        self.assertEqual(expected_projection(b'0427\n1\n4')[-3:],
                         (('balance', 100), ('menu', 100), ('end', 100)))
        self.assertEqual(expected_projection(b'0427\n2\n25\n4')[-1], ('end', 125))

    def test_lf_crlf_and_unterminated_final_line_equivalent(self):
        a = b'0427\n2\n25\n1\n4\n'
        self.assertEqual(expected_projection(a), expected_projection(a.replace(b'\n', b'\r\n')))
        self.assertEqual(expected_projection(a), expected_projection(a[:-1]))


class OracleBoundary(unittest.TestCase):
    def test_current_contract_never_invents_an_automatic_pass_or_failure(self):
        stdin = b'0427\n1\n4'
        for stdout in (b'Your balance is one hundred. Goodbye!', emit(expected_projection(stdin)), b'bad'):
            self.assertEqual(compare(stdin, stdout, process_terminated=True).kind, 'unresolved_contract')

    def test_independent_expected_values_do_not_come_from_student_claims(self):
        stdin = b'0427\n2\n25\n1\n4'
        good = expected_projection(stdin)
        self.assertEqual(compare(stdin, emit(good), contract=CANDIDATE_CONTRACT,
                                 process_terminated=True).kind, 'observations_match')
        for wrong in (0, 100, 124, 126, 1000):
            with self.subTest(wrong=wrong):
                altered = tuple((tag, wrong if tag == 'balance' else value) for tag, value in good)
                self.assertEqual(compare(stdin, emit(altered), contract=CANDIDATE_CONTRACT,
                                         process_terminated=True).kind, 'projection_mismatch')

    def test_duplicate_missing_reordered_and_spurious_facts_rejected(self):
        stdin = b'0427\n2\n25\n1\n4'
        good = expected_projection(stdin)
        variants = (good[:-1], good+(('balance', 10000),), tuple(reversed(good)), good+good)
        for events in variants:
            with self.subTest(events=events):
                self.assertEqual(compare(stdin, emit(events), contract=CANDIDATE_CONTRACT,
                                         process_terminated=True).kind, 'projection_mismatch')

    def test_rejected_operation_cannot_claim_success_even_if_balance_unchanged(self):
        stdin = b'0427\n3\n101\n1\n4'
        altered = tuple(('accepted', value) if tag == 'rejected' else (tag, value)
                        for tag, value in expected_projection(stdin))
        self.assertEqual(compare(stdin, emit(altered), contract=CANDIDATE_CONTRACT,
                                 process_terminated=True).kind, 'projection_mismatch')

    def test_pending_eof_cannot_claim_mutation_reset_or_balance_summary_from_start(self):
        stdin = b'0427\n2\n25\n3\n'
        good = expected_projection(stdin)
        for value in (0, 100, 85):
            with self.subTest(value=value):
                self.assertEqual(compare(stdin, emit(good[:-1]+(('end', value),)), contract=CANDIDATE_CONTRACT,
                                         process_terminated=True).kind, 'projection_mismatch')

    def test_no_number_scraping_no_english_phrase_detector(self):
        invalid = (b'Balance: 100\n', b'PASSED 100\n', b'1 2 3 4 100\n',
                   b'{"pass":true,"balance":100}\n', b'100\n', b'example ["balance",100]\n',
                   b'["balance",100] extra\n')
        for stdout in invalid:
            with self.subTest(stdout=stdout):
                self.assertEqual(compare(b'0427\n1\n4', stdout, contract=CANDIDATE_CONTRACT,
                                         process_terminated=True).kind, 'projection_mismatch')

    def test_strict_data_types_and_known_projection_grammar(self):
        invalid = (b'["balance",true]', b'["balance",100.0]', b'["balance",-1]',
                   b'["balance",10001]', b'["balance",null]', b'["end",NaN]',
                   b'["balance",100,100]', b'["success",100]', '["bаlance",100]'.encode(),
                   b'\xff', b'\x1b[2J["balance",100]')
        for stdout in invalid:
            with self.subTest(stdout=stdout):
                with self.assertRaises((ValueError, UnicodeError)):
                    parse_candidate_output(stdout)

    def test_output_line_endings_and_edge_whitespace_are_presentation_only(self):
        stdin = b'0427\n1\n4'
        text = b' \t\r\n'+b'\r\n'.join(b' '+json.dumps(e).encode()+b'\t' for e in expected_projection(stdin))+b'\r\n'
        self.assertEqual(compare(stdin, text, contract=CANDIDATE_CONTRACT,
                                 process_terminated=True).kind, 'observations_match')

    def test_termination_must_be_independently_observed_not_asserted_in_output(self):
        stdin = b'0427\n4'
        for observed in (None, False, 'true'):
            with self.subTest(observed=observed):
                self.assertEqual(compare(stdin, emit(expected_projection(stdin)), contract=CANDIDATE_CONTRACT,
                                         process_terminated=observed).kind, 'incomplete_observation')

    def test_unspecified_input_is_not_silently_failed(self):
        for stdin in (b'x'*21, b'\xff'):
            with self.subTest(stdin=stdin):
                self.assertEqual(compare(stdin, b'', contract=CANDIDATE_CONTRACT,
                                         process_terminated=True).kind, 'outside_assessed_input')


class ConcreteCounterexamples(unittest.TestCase):
    def test_numeric_projection_collides_for_valid_and_invalid_prose(self):
        # Demonstration only: this lossy extractor is deliberately NOT the oracle.
        import re
        valid = b'Previous balance 100. Deposit 25 accepted. Current balance 125.'
        invalid = b'Current balance 100. Deposit 25 accepted. Previous balance 125.'
        self.assertNotEqual(valid, invalid)
        self.assertEqual(re.findall(rb'\d+', valid), re.findall(rb'\d+', invalid))

    def test_casefold_whitespace_normalization_cannot_resolve_roles(self):
        valid = 'Previous balance 100. Deposit 25 accepted. Current balance 125.'
        invalid = 'Current balance 100. Deposit 25 accepted. Previous balance 125.'
        self.assertEqual(sorted(valid.lower().split()), sorted(invalid.lower().split()))

    def test_identical_visible_trace_cannot_prove_unobservable_internal_exit_assignment(self):
        # Two whole-program behaviors are identical for every possible stdin until return.
        # Only the second assigns balance=100 after its final print and before returning.
        trace = b'Menu: 1 balance; 2 deposit; 3 withdraw; 4 exit.\nDeposit accepted.\nGoodbye.\n'
        correct = {'stdout': trace, 'stdin': b'0427\n2\n25\n4', 'balance_before_return': 125}
        reset_at_return = {'stdout': trace, 'stdin': b'0427\n2\n25\n4', 'balance_before_return': 100}
        self.assertEqual(correct['stdout'], reset_at_return['stdout'])
        self.assertEqual(correct['stdin'], reset_at_return['stdin'])
        self.assertNotEqual(correct['balance_before_return'], reset_at_return['balance_before_return'])

    def test_prototype_never_claims_free_prose_clarity_team_participation_or_source_proof(self):
        result = compare(b'0427\n4', emit((('menu', 100), ('end', 100))),
                         contract=CANDIDATE_CONTRACT, process_terminated=True)
        self.assertEqual(result.kind, 'observations_match')
        self.assertIn('not an academic PASS', result.detail)


if __name__ == '__main__':
    unittest.main()
