"""Offline checks for setup examples; no credentials required."""
from __future__ import annotations

import re
import unittest
from pathlib import Path

from deployment.models import DeploymentConfig


REPO_ROOT = Path(__file__).resolve().parents[3]


class DeploymentExampleTest(unittest.TestCase):
    def test_testnet_example_loads_with_public_parser(self) -> None:
        # Validate without resolving identities, placeholders, or artifacts.
        config = DeploymentConfig.load(
            REPO_ROOT / "deployment" / "config.testnet.json"
        )
        self.assertEqual(config.profile, "development")
        self.assertTrue(config.contracts)
        self.assertEqual(len(config.ordered_contracts()), len(config.contracts))
        for contract in config.contracts:
            with self.subTest(contract=contract.name):
                self.assertIn("${wasm_dir}", contract.artifact)
                arguments = (
                    contract.initialize_args
                    if contract.deployment_mode == "initialize"
                    else contract.constructor_args
                )
                self.assertEqual(arguments["admin"], "${admin}")


class DockerEnvironmentExampleTest(unittest.TestCase):
    def test_example_defines_compose_interpolation_variables(self) -> None:
        example = (REPO_ROOT / ".env.docker.example").read_text(encoding="utf-8")
        defined = set(re.findall(
            r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=",
            example,
            re.MULTILINE,
        ))
        compose_files = sorted({
            path
            for pattern in ("docker-compose*.yml", "docker-compose*.yaml",
                            "compose*.yml", "compose*.yaml")
            for path in REPO_ROOT.glob(pattern)
        })
        self.assertTrue(compose_files, "No root compose files found")
        # Scan the interpolation syntax used in this repository, including
        # default/required forms. Escaped $$ is container-side text.
        variable = re.compile(
            r"\$(?:\{([A-Za-z_][A-Za-z0-9_]*)(?=[}:?+\-])"
            r"|([A-Za-z_][A-Za-z0-9_]*))"
        )
        for compose in compose_files:
            with self.subTest(compose=compose.name):
                text = "\n".join(
                    line for line in compose.read_text(encoding="utf-8").splitlines()
                    if not line.lstrip().startswith("#")
                ).replace("$$", "")
                referenced = {
                    braced or plain for braced, plain in variable.findall(text)
                }
                missing = sorted(referenced - defined)
                self.assertFalse(
                    missing,
                    f"{compose.name}: missing names in .env.docker.example: "
                    + ", ".join(missing),
                )


if __name__ == "__main__":
    unittest.main()
