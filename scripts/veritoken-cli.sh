#!/usr/bin/env bash
# veritoken — Unified CLI for Veritoken operations (#398)
#
# Usage:
#   bash scripts/veritoken-cli.sh <command> [args...]
#   ./scripts/veritoken-cli.sh <command> [args...]
#
# Commands:
#   setup      [--deploy] [--docker]          Bootstrap local dev environment
#   deploy     [identity]                     Build and deploy all contracts
#   identity   [name]                         Create and fund a testnet identity
#
#   kyc approve  <addr> <tier> <expiry> <jur>  Approve KYC for an address
#   kyc revoke   <addr>                         Revoke KYC for an address
#   kyc check    <addr>                         Query KYC record
#   kyc add-verifier    <addr>                  Add a KYC verifier
#   kyc remove-verifier <addr>                  Remove a KYC verifier
#
#   compliance pause                            Halt all transfers
#   compliance unpause                          Resume transfers
#   compliance set-rules <args...>              Update compliance rules
#   compliance blocklist add    <addr>          Add address to blocklist
#   compliance blocklist remove <addr>          Remove address from blocklist
#
#   test                                        Run Rust contract tests
#   sdk-test                                    Run SDK TypeScript tests
#   health                                      Check docker stack health
#
#   help [command]                              Show this help or command help

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ADMIN_DIR="$SCRIPT_DIR/admin"

# ── Helpers ───────────────────────────────────────────────────────────────────
usage() {
  sed -n '2,40p' "$0" | sed 's/^# \?//'
  exit 0
}

die() { echo "ERROR: $*" >&2; exit 1; }

require_arg() {
  [[ -n "${1:-}" ]] || die "Missing required argument: $2"
}

# ── Dispatch ──────────────────────────────────────────────────────────────────
COMMAND="${1:-help}"
shift || true

case "$COMMAND" in

  # ── Environment setup ──────────────────────────────────────────────────────
  setup)
    exec bash "$SCRIPT_DIR/setup-local.sh" "$@"
    ;;

  # ── Deploy ─────────────────────────────────────────────────────────────────
  deploy)
    exec bash "$SCRIPT_DIR/deploy.sh" "$@"
    ;;

  # ── Identity ───────────────────────────────────────────────────────────────
  identity)
    exec bash "$SCRIPT_DIR/setup-identity.sh" "$@"
    ;;

  # ── KYC ────────────────────────────────────────────────────────────────────
  kyc)
    SUB="${1:-}"; shift || true
    case "$SUB" in
      approve)
        require_arg "${1:-}" "<subject_address>"
        exec bash "$ADMIN_DIR/approve-kyc.sh" "$@"
        ;;
      revoke)
        require_arg "${1:-}" "<subject_address>"
        exec bash "$ADMIN_DIR/revoke-kyc.sh" "$@"
        ;;
      check)
        require_arg "${1:-}" "<address>"
        exec bash "$ADMIN_DIR/check-kyc.sh" "$@"
        ;;
      add-verifier)
        require_arg "${1:-}" "<verifier_address>"
        exec bash "$ADMIN_DIR/add-verifier.sh" "$@"
        ;;
      remove-verifier)
        require_arg "${1:-}" "<verifier_address>"
        exec bash "$ADMIN_DIR/remove-verifier.sh" "$@"
        ;;
      *)
        echo "Usage: veritoken-cli.sh kyc <approve|revoke|check|add-verifier|remove-verifier> [args...]"
        exit 1
        ;;
    esac
    ;;

  # ── Compliance ─────────────────────────────────────────────────────────────
  compliance)
    SUB="${1:-}"; shift || true
    case "$SUB" in
      pause)
        exec bash "$ADMIN_DIR/pause.sh"
        ;;
      unpause)
        exec bash "$ADMIN_DIR/unpause.sh"
        ;;
      set-rules)
        exec bash "$ADMIN_DIR/set-rules.sh" "$@"
        ;;
      blocklist)
        ACTION="${1:-}"; shift || true
        case "$ACTION" in
          add)
            require_arg "${1:-}" "<address>"
            exec bash "$ADMIN_DIR/add-blocklist.sh" "$@"
            ;;
          remove)
            require_arg "${1:-}" "<address>"
            exec bash "$ADMIN_DIR/remove-blocklist.sh" "$@"
            ;;
          *)
            echo "Usage: veritoken-cli.sh compliance blocklist <add|remove> <address>"
            exit 1
            ;;
        esac
        ;;
      *)
        echo "Usage: veritoken-cli.sh compliance <pause|unpause|set-rules|blocklist> [args...]"
        exit 1
        ;;
    esac
    ;;

  # ── Tests ──────────────────────────────────────────────────────────────────
  test)
    exec cargo test --features testutils "$@"
    ;;

  sdk-test)
    exec npm run --workspace sdk test "$@"
    ;;

  # ── Health ─────────────────────────────────────────────────────────────────
  health)
    exec bash "$SCRIPT_DIR/docker-health.sh" "$@"
    ;;

  # ── Help ───────────────────────────────────────────────────────────────────
  help|--help|-h)
    if [[ -n "${1:-}" ]]; then
      # Delegate to the underlying script's help if it supports it
      case "$1" in
        setup)      bash "$SCRIPT_DIR/setup-local.sh" --help ;;
        deploy)     grep -m5 '^#' "$SCRIPT_DIR/deploy.sh" | sed 's/^# \?//' ;;
        kyc)        grep -m10 '^#' "$ADMIN_DIR/approve-kyc.sh" | sed 's/^# \?//' ;;
        compliance) grep -m10 '^#' "$ADMIN_DIR/set-rules.sh" | sed 's/^# \?//' ;;
        *)          usage ;;
      esac
    else
      usage
    fi
    ;;

  *)
    echo "Unknown command: $COMMAND"
    echo "Run 'bash scripts/veritoken-cli.sh help' for usage."
    exit 1
    ;;
esac
