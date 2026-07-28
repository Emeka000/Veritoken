# Secret-Safe Deployment

This guide explains which values are safe to share and which must be kept private. Read this before deploying to testnet or mainnet.

---

## The Golden Rule

**Never commit a secret to the repository.**

Secrets include:

- Secret keys and seed phrases for any Stellar account (admin, verifier, deployer)
- Environment files that contain the above (`.env.docker`, `frontend/.env` with real IDs tied to funded accounts)
- Any value that grants unilateral control over a deployed contract

If a secret was ever committed, rotate it immediately — even if you deleted it in a later commit. Git history is permanent.

---

## What Is Safe to Share

| Value | Safe? | Notes |
|---|---|---|
| Contract IDs (C-prefix addresses) | ✅ Yes | Public on-chain. Safe to put in `README.md`, issues, or discussions. |
| Public key / Stellar address (G-prefix) | ✅ Yes | Public by design. |
| Network names (`testnet`, `mainnet`, `standalone`) | ✅ Yes | |
| RPC and Horizon URLs | ✅ Yes | Public endpoints. |
| WASM binaries | ✅ Yes | Compiled output; source is public. |
| IPFS hashes for documents | ✅ Yes | Content-addressed; safe to share. |
| `.env.example` and `.env.docker.example` | ✅ Yes | Template files with no real values. |

## What Must Stay Private

| Value | Private? | Notes |
|---|---|---|
| Secret key (`S`-prefix) or seed phrase | 🔴 Never share | Full account control. Compromise = loss of all assets and admin control. |
| `ADMIN_SECRET_KEY` in any `.env` file | 🔴 Never share | Used by deploy and admin scripts. |
| Hardware wallet PIN or mnemonic | 🔴 Never share | |
| Verifier key | 🔴 Never share | Can approve fraudulent KYC subjects. |
| `.env.docker` | 🔴 Never commit | Listed in `.gitignore`. |
| `frontend/.env` if it contains funded account keys | 🔴 Never commit | Listed in `.gitignore`. |

---

## Environment Variable Injection

All scripts and Docker services read secrets from environment variables rather than hard-coded values. This is by design.

### Local development (Docker)

```bash
# Copy the template — never edit the example file itself
cp .env.docker.example .env.docker

# Edit .env.docker — this file is gitignored
# Set ADMIN_SECRET_KEY to a throwaway testnet key only
nano .env.docker

# Start the stack — the .env.docker file is never mounted inside containers;
# Docker reads it at startup and passes the values as environment variables
docker compose --env-file .env.docker up
```

Never pass secret keys as command-line arguments. They appear in `ps`, shell history, and CI logs.

### CI

Store secrets in GitHub Actions repository secrets (`Settings → Secrets and variables → Actions`), not in workflow YAML files:

```yaml
# ✅ Correct — secret injected from repository secrets
- name: Deploy contracts
  env:
    ADMIN_SECRET_KEY: ${{ secrets.ADMIN_SECRET_KEY }}
  run: bash scripts/deploy.sh veritoken-ci
```

```yaml
# ❌ Wrong — secret visible in logs and git history
- name: Deploy contracts
  run: ADMIN_SECRET_KEY=SABC123... bash scripts/deploy.sh veritoken-ci
```

### Local non-Docker

```bash
# Export into the current shell session only — not persisted to .bashrc or history
export ADMIN_SECRET_KEY="SABC..."

bash scripts/deploy.sh veritoken-dev

# Unset after use
unset ADMIN_SECRET_KEY
```

To prevent the command from appearing in shell history, prefix it with a space (in bash with `HISTCONTROL=ignorespace`):

```bash
 export ADMIN_SECRET_KEY="SABC..."
```

---

## Shell History

Shell history is a common leak vector. Secret keys typed directly into the terminal can be recovered from `~/.bash_history` or `~/.zsh_history`.

Best practices:
- Use environment variable injection from files (see above) rather than inline values.
- After any accidental exposure, rotate the key and clear the history entry:
  ```bash
  history -d $(history | grep -n SECRET | tail -1 | awk '{print $1}')
  ```
- For production, use a hardware wallet or secrets manager so the raw key never touches the terminal at all.

---

## Placeholder Values in Documentation

All commands in `docs/mainnet-deployment.md`, `docs/incident-response.md`, and the `scripts/` directory use placeholder values for secrets. They look like:

```
<your-admin-keypair-name>
<ADMIN_ADDRESS>
G...VERIFIER_ADDRESS
SABC...  (never appears — use env vars)
```

These are intentional. Do not replace them with real values in documentation commits.

---

## Detecting Accidental Leaks

Before opening a pull request, scan staged changes for secret-like patterns:

```bash
# Simple grep for S-prefix Stellar secret keys (52-character base32 strings)
git diff --cached | grep -E '\bS[A-Z2-7]{55}\b'

# Or use a dedicated tool such as truffleHog or git-secrets
# https://github.com/trufflesecurity/trufflehog
# https://github.com/awslabs/git-secrets
```

If a secret is found:

1. Do **not** push.
2. Rotate the key immediately — treat it as compromised even if the diff is local.
3. Remove the secret from the staged change and re-stage.

---

## Reporting an Accidental Exposure

If a secret has already been pushed to a public repository:

1. Rotate the key immediately.
2. Follow the [Incident Response Runbook](incident-response.md) — specifically the Admin Key Rotation and Compromised Verifier sections as applicable.
3. Report the exposure via the [Security Policy](../SECURITY.md).

Do not open a public issue for a secret exposure.
