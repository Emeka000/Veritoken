from __future__ import annotations

import unittest

from deployment.runner import (
    encode_contract_args,
    encode_contract_value,
    normalize_metadata,
)


class RunnerEncodingTest(unittest.TestCase):
    def test_contract_arguments_are_hyphenated_and_json_canonicalized(self) -> None:
        self.assertEqual(
            encode_contract_args(
                {
                    "kyc_registry": "CREGISTRY",
                    "meta": {"z": 1, "a": None},
                    "paused": False,
                }
            ),
            [
                "--kyc-registry",
                "CREGISTRY",
                "--meta",
                '{"a":null,"z":1}',
                "--paused",
                "false",
            ],
        )

    def test_scalar_encoding_matches_stellar_cli_values(self) -> None:
        self.assertEqual(encode_contract_value(None), "null")
        self.assertEqual(encode_contract_value(True), "true")
        self.assertEqual(encode_contract_value(17), "17")

    def test_metadata_json_is_stable(self) -> None:
        self.assertEqual(
            normalize_metadata(' { "z": 1, "a": [2] } '),
            '{"a":[2],"z":1}',
        )
        self.assertEqual(normalize_metadata("first  \nsecond "), "first\nsecond")


if __name__ == "__main__":
    unittest.main()
