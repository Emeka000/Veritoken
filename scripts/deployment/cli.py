from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Sequence

from .models import (
    MANIFEST_SCHEMA_VERSION,
    DeploymentConfig,
    DeploymentError,
    NetworkConfig,
    VerificationFailed,
    atomic_write_json,
    load_json_object,
)
from .orchestrator import DeploymentOrchestrator, verify_manifest
from .runner import StellarCliClient
from .upgrade_simulation import simulate_upgrade


def build_parser() -> argparse.ArgumentParser:
    repo_root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(
        prog="deployment_cli",
        description=(
            "Deploy, register, and verify Veritoken Soroban contracts with "
            "resumable checkpoints and auditable JSON output."
        ),
    )
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=repo_root,
        help="repository root (defaults to the root containing this script)",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    deploy = subparsers.add_parser(
        "deploy",
        help="upload and deploy contracts, verify them, then atomically publish registry files",
    )
    _add_common_config(deploy, repo_root)
    _add_network_options(deploy)
    deploy.add_argument(
        "--identity",
        default=os.environ.get("STELLAR_IDENTITY", "alice"),
        help="Stellar CLI source-account identity or address",
    )
    deploy.add_argument(
        "--manifest",
        type=Path,
        default=Path(os.environ.get("DEPLOY_MANIFEST", "deploy-manifest.json")),
    )
    deploy.add_argument(
        "--report",
        type=Path,
        default=Path(
            os.environ.get(
                "DEPLOY_VERIFICATION_REPORT",
                "deployment-verification-report.json",
            )
        ),
    )
    deploy.add_argument(
        "--frontend-env",
        type=Path,
        default=Path(os.environ.get("FRONTEND_ENV_FILE", "frontend/.env")),
    )
    deploy.add_argument(
        "--resume",
        action="store_true",
        default=_truthy(os.environ.get("DEPLOY_RESUME")),
        help="resume the exact matching partial checkpoint",
    )
    deploy.add_argument(
        "--stellar-bin",
        default=os.environ.get("STELLAR_BIN", "stellar"),
    )

    verify = subparsers.add_parser(
        "verify",
        help="verify local artifacts, deployed code hashes, metadata, and read checks",
    )
    verify.add_argument(
        "--manifest",
        type=Path,
        default=Path(os.environ.get("DEPLOY_MANIFEST", "deploy-manifest.json")),
    )
    verify.add_argument(
        "--report",
        type=Path,
        default=Path(
            os.environ.get(
                "DEPLOY_VERIFICATION_REPORT",
                "deployment-verification-report.json",
            )
        ),
    )
    verify.add_argument(
        "--identity",
        default=os.environ.get("STELLAR_IDENTITY"),
        help="override the source-account identity stored in the manifest",
    )
    verify.add_argument(
        "--stellar-bin",
        default=os.environ.get("STELLAR_BIN", "stellar"),
    )

    plan = subparsers.add_parser(
        "plan",
        help="validate configuration and print the dependency-ordered operation plan",
    )
    _add_common_config(plan, repo_root)
    _add_network_options(plan)

    validate = subparsers.add_parser(
        "validate-manifest",
        help="perform offline structural validation of a deployment manifest",
    )
    validate.add_argument(
        "--manifest",
        type=Path,
        default=Path(os.environ.get("DEPLOY_MANIFEST", "deploy-manifest.json")),
    )

    simulate = subparsers.add_parser(
        "simulate-upgrade",
        help=(
            "simulate a contract upgrade offline: diff the new artifact's "
            "interface against the deployed one and check schema-version "
            "sequencing, without deploying or changing live state"
        ),
    )
    simulate.add_argument(
        "--manifest",
        type=Path,
        default=Path(os.environ.get("DEPLOY_MANIFEST", "deploy-manifest.json")),
        help="canonical manifest recording the currently deployed artifact",
    )
    simulate.add_argument(
        "--contract",
        required=True,
        help="contract name as it appears in the manifest (e.g. compliance_engine)",
    )
    simulate.add_argument(
        "--new-artifact",
        type=Path,
        required=True,
        help="path to the candidate WASM artifact to simulate upgrading to",
    )
    simulate.add_argument(
        "--to-schema-version",
        type=int,
        default=None,
        help="optional: the schema_version migrate_schema would be called with",
    )
    simulate.add_argument(
        "--report",
        type=Path,
        default=Path(
            os.environ.get(
                "UPGRADE_SIMULATION_REPORT", "upgrade-simulation-report.json"
            )
        ),
    )
    simulate.add_argument(
        "--identity",
        default=os.environ.get("STELLAR_IDENTITY"),
        help=(
            "optional: perform a read-only live schema_version check against "
            "this identity (no state is changed). Omit to simulate fully offline."
        ),
    )
    _add_network_options(simulate)
    simulate.add_argument(
        "--stellar-bin",
        default=os.environ.get("STELLAR_BIN", "stellar"),
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    repo_root = args.repo_root.resolve()
    try:
        if args.command == "deploy":
            return _deploy(args, repo_root)
        if args.command == "verify":
            return _verify(args, repo_root)
        if args.command == "plan":
            return _plan(args, repo_root)
        if args.command == "validate-manifest":
            return _validate_manifest(args, repo_root)
        if args.command == "simulate-upgrade":
            return _simulate_upgrade(args, repo_root)
        parser.error(f"unknown command: {args.command}")
    except VerificationFailed as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        summary = exc.report.get("summary", {})
        print(
            f"Verification: {summary.get('passed', 0)} passed, "
            f"{summary.get('failed', 0)} failed.",
            file=sys.stderr,
        )
        return 1
    except DeploymentError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    return 2


def _deploy(args: argparse.Namespace, repo_root: Path) -> int:
    config = DeploymentConfig.load(_resolve(args.config, repo_root))
    network = _network_from_args(args)
    orchestrator = DeploymentOrchestrator(StellarCliClient(args.stellar_bin))
    manifest, report = orchestrator.deploy(
        config=config,
        repo_root=repo_root,
        wasm_dir=args.wasm_dir,
        identity=args.identity,
        network=network,
        manifest_path=args.manifest,
        report_path=args.report,
        frontend_env_path=args.frontend_env,
        resume=args.resume,
    )
    summary = report["summary"]
    print(
        f"Deployment {manifest['deployment_id']} verified: "
        f"{summary['passed']}/{summary['total']} checks passed."
    )
    print(f"Canonical manifest: {_resolve(args.manifest, repo_root)}")
    print(f"Verification report: {_resolve(args.report, repo_root)}")
    print(f"Frontend environment: {_resolve(args.frontend_env, repo_root)}")
    return 0


def _verify(args: argparse.Namespace, repo_root: Path) -> int:
    manifest_path = _resolve(args.manifest, repo_root)
    report_path = _resolve(args.report, repo_root)
    manifest = load_json_object(manifest_path)
    report = verify_manifest(
        manifest=manifest,
        repo_root=repo_root,
        client=StellarCliClient(args.stellar_bin),
        identity=args.identity,
    )
    atomic_write_json(report_path, report)
    summary = report["summary"]
    print(
        f"Deployment verification {report['status']}: "
        f"{summary['passed']} passed, {summary['failed']} failed."
    )
    print(f"Verification report: {report_path}")
    return 0 if report["status"] == "passed" else 1


def _plan(args: argparse.Namespace, repo_root: Path) -> int:
    config_path = _resolve(args.config, repo_root)
    config = DeploymentConfig.load(config_path)
    network = _network_from_args(args)
    config.validate_for_network(network)
    wasm_dir = _resolve(args.wasm_dir, repo_root)
    plan = {
        "schema_version": MANIFEST_SCHEMA_VERSION,
        "profile": config.profile,
        "network": network.as_public_dict(),
        "config": str(config_path),
        "operations": [
            {
                "order": index,
                "contract": contract.name,
                "artifact": contract.artifact.replace(
                    "${wasm_dir}", wasm_dir.as_posix()
                ),
                "dependencies": list(contract.dependencies),
                "deployment_mode": contract.deployment_mode,
                "operations": [
                    "upload_wasm",
                    "deploy_contract",
                    *(
                        [f"invoke:{contract.initialize_function}"]
                        if contract.deployment_mode == "initialize"
                        else []
                    ),
                    "verify_code_hash",
                    "verify_contract_metadata",
                    *(
                        [f"health_check:{contract.health_check.function}"]
                        if contract.health_check
                        else []
                    ),
                ],
            }
            for index, contract in enumerate(config.ordered_contracts(), start=1)
        ],
    }
    print(json.dumps(plan, indent=2, sort_keys=True))
    return 0


def _validate_manifest(args: argparse.Namespace, repo_root: Path) -> int:
    manifest_path = _resolve(args.manifest, repo_root)
    manifest = load_json_object(manifest_path)
    if manifest.get("schema_version") != MANIFEST_SCHEMA_VERSION:
        raise DeploymentError(
            f"manifest schema_version must be {MANIFEST_SCHEMA_VERSION}"
        )
    network = manifest.get("network")
    if not isinstance(network, dict):
        raise DeploymentError("manifest network must be an object")
    NetworkConfig.from_dict(network)
    contracts = manifest.get("contracts")
    if not isinstance(contracts, dict) or not contracts:
        raise DeploymentError("manifest contracts must be a non-empty object")
    for name, record in contracts.items():
        if not isinstance(name, str) or not name:
            raise DeploymentError("manifest contract names must be non-empty strings")
        if not isinstance(record, dict):
            raise DeploymentError(f"manifest contract {name} must be an object")
        for field in ("contract_id", "wasm_hash", "artifact"):
            if field not in record:
                raise DeploymentError(f"manifest contract {name} is missing {field}")
    print(
        f"Manifest is structurally valid: {manifest_path} "
        f"({len(contracts)} contracts)."
    )
    return 0


def _simulate_upgrade(args: argparse.Namespace, repo_root: Path) -> int:
    manifest_path = _resolve(args.manifest, repo_root)
    new_artifact = _resolve(args.new_artifact, repo_root)
    report_path = _resolve(args.report, repo_root)

    client = None
    network = None
    if args.identity:
        client = StellarCliClient(args.stellar_bin)
        network = _network_from_args(args)

    report = simulate_upgrade(
        contract_name=args.contract,
        manifest_path=manifest_path,
        new_artifact=new_artifact,
        repo_root=repo_root,
        to_schema_version=args.to_schema_version,
        client=client,
        identity=args.identity,
        network=network,
    )
    atomic_write_json(report_path, report)

    summary = report["summary"]
    print(
        f"Upgrade simulation for {args.contract}: {report['status']} "
        f"({summary['critical_risk_count']} critical risk(s), "
        f"{summary['removed_function_count']} removed function(s), "
        f"{summary['added_function_count']} added function(s))."
    )
    for risk in report["risks"]:
        print(f"  [{risk['level']}] {risk['message']}")
    print(f"Report: {report_path}")
    return 0 if report["status"] == "ok" else 1


def _add_common_config(
    parser: argparse.ArgumentParser, repo_root: Path
) -> None:
    parser.add_argument(
        "--config",
        type=Path,
        default=Path(
            os.environ.get(
                "DEPLOY_CONFIG",
                str(repo_root / "deployment" / "config.testnet.json"),
            )
        ),
    )
    parser.add_argument(
        "--wasm-dir",
        type=Path,
        default=Path(
            os.environ.get(
                "WASM_DIR",
                "target/wasm32-unknown-unknown/release",
            )
        ),
    )


def _add_network_options(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--network",
        default=os.environ.get("STELLAR_NETWORK", "testnet"),
    )
    parser.add_argument(
        "--rpc-url",
        default=os.environ.get("STELLAR_RPC_URL"),
    )
    parser.add_argument(
        "--network-passphrase",
        default=os.environ.get("STELLAR_NETWORK_PASSPHRASE"),
    )


def _network_from_args(args: argparse.Namespace) -> NetworkConfig:
    return NetworkConfig(
        name=args.network,
        rpc_url=args.rpc_url,
        passphrase=args.network_passphrase,
    )


def _resolve(path: Path, repo_root: Path) -> Path:
    return path.resolve() if path.is_absolute() else (repo_root / path).resolve()


def _truthy(value: str | None) -> bool:
    return bool(value and value.lower() in {"1", "true", "yes", "on"})
