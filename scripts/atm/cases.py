"""Private assessment authoring inputs; excluded from learner/content packages.

Only approved business/ReadLine paths are exercised. No expected observations,
reference solution, scoring, or new learner requirements are authored here.
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class InputCase:
    name: str
    rule: str
    input: str


def journey(*lines: str, newline: str = "\n") -> str:
    return newline.join(lines) + newline


PUBLIC = (
    InputCase("eof-before-login", "eof-at-any-prompt", ""),
    InputCase("ordinary-journey", "balance-deposit-withdraw-exit",
              journey("0427", "1", "2", "25", "3", "40", "1", "4")),
    InputCase("three-wrong-pins", "three-failed-logins",
              journey("1111", "2222", "3333")),
    InputCase("invalid-amount", "whole-line-amount-validation",
              journey("0427", "2", "25x", "1", "4")),
    InputCase("withdraw-current-balance", "inclusive-zero-balance",
              journey("0427", "3", "100", "1", "4")),
    InputCase("eof-at-deposit", "no-pending-operation-on-eof",
              journey("0427", "2")),
)

_TO_9500 = ("0427",) + ("2", "1000") * 9 + ("2", "400")
_TO_10000 = _TO_9500 + ("2", "500")

PRIVATE = (
    InputCase("third-pin-valid", "exact-text-pin",
              journey("427", " 0427", "0427", "4")),
    InputCase("blank-and-nondigit-pin", "malformed-pin-counts-as-failure",
              journey("", "abcd", "0427", "4")),
    InputCase("unicode-pin", "exact-text-pin",
              journey("٠٤٢٧", "0427", "4")),
    InputCase("failure-limit-terminal", "three-failed-logins",
              journey("1111", "", "427", "0427", "4")),
    InputCase("invalid-menu", "exact-menu-options",
              journey("0427", "", "01", "9", " 1", "1 ", "1", "4")),
    InputCase("minimum-deposit", "inclusive-transaction-range",
              journey("0427", "2", "1", "1", "4")),
    InputCase("maximum-deposit", "inclusive-transaction-range",
              journey("0427", "2", "1000", "1", "4")),
    InputCase("leading-zeros", "up-to-five-ascii-digits",
              journey("0427", "2", "00025", "3", "00001", "1", "4")),
    InputCase("outside-amount-range", "transaction-range-rejection",
              journey("0427", "2", "0", "2", "1001", "2", "10000", "1", "4")),
    InputCase("amount-format", "whole-line-amount-validation",
              journey("0427", "2", "-1", "2", "+1", "2", "1.5",
                      "2", " 25", "2", "25 ", "2", "25x", "2", "", "2", "٢٥", "1", "4")),
    InputCase("amount-length", "up-to-five-ascii-digits",
              journey("0427", "2", "000001", "2", "12345678901234567890", "1", "4")),
    InputCase("insufficient-then-valid", "rejection-preserves-balance",
              journey("0427", "3", "101", "3", "1", "1", "4")),
    InputCase("cap-inclusive", "inclusive-balance-cap",
              journey(*_TO_9500, "2", "500", "1", "4")),
    InputCase("cap-whole-rejection", "reject-entire-over-cap-deposit",
              journey(*_TO_9500, "2", "501", "1", "4")),
    InputCase("cap-reject-and-recover", "committed-state-after-rejection",
              journey(*_TO_10000, "2", "1", "3", "1000", "2", "1000", "1", "4")),
    InputCase("eof-after-failed-pin", "eof-is-not-another-failure",
              journey("1111")),
    InputCase("eof-at-menu", "eof-at-any-prompt", journey("0427")),
    InputCase("eof-at-withdraw", "no-pending-operation-on-eof",
              journey("0427", "3")),
    InputCase("eof-after-committed-deposit", "terminal-committed-balance",
              journey("0427", "2", "25", "3")),
    InputCase("final-line-no-newline", "read-final-unterminated-line",
              "0427\n2\n25"),
    InputCase("crlf-lines", "readline-removes-crlf",
              journey("0427", "2", "25", "1", "4", newline="\r\n")),
    InputCase("exit-terminal", "exit-ignores-later-input",
              journey("0427", "4", "2", "1000")),
    InputCase("zero-insufficient", "nonnegative-balance",
              journey("0427", "3", "100", "3", "1", "1", "4")),
)
