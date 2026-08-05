# Issue Triage Workflow

This document defines the lightweight issue triage matrix and process for Veritoken.

## Triage Matrix

### Priority Levels
| Level | Description |
|---|---|
| **P0 / Critical Security** | Critical security vulnerabilities, major regressions in core compliance logic, or total system breakage. Requires immediate attention. |
| **P1 / Core Engine** | Issues affecting the core functionality of the KYC registry, compliance engine, or base RWA tokens. |
| **P2 / Enhancements** | Feature requests, UI/UX improvements, documentation updates, and minor bug fixes. |

## Label Classifications
We use standard label classifications to categorize issues:
- `security`: Related to security vulnerabilities or audit findings.
- `contracts`: Related to Soroban smart contracts.
- `frontend`: Related to the React-based frontend application.
- `sdk`: Related to the TypeScript/Rust SDKs.
- `deployment`: Related to Docker, CI/CD, or deployment scripts.
- `documentation`: Related to READMEs, KDocs, or external documentation.

## Escalation Pathways
- **Urgent Hotfixes:** P0 issues must be escalated by tagging the lead maintainers in the issue or via the project's communication channels. Hotfixes follow an accelerated review process.
- **Assignment Rules:**
  - `contracts` issues are reviewed by the Smart Contract team.
  - `frontend` issues are reviewed by the Frontend team.
  - `sdk` and `deployment` issues are reviewed by the Integration team.
  - `security` issues are reviewed by the Security lead and require dual-authorization before merging.
