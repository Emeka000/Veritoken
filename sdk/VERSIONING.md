# SDK Versioning Policy

`@veritoken/sdk` follows [Semantic Versioning 2.0.0](https://semver.org).

## Version format

```
MAJOR.MINOR.PATCH
```

| Increment | When |
|---|---|
| `PATCH` | Bug fixes, documentation corrections, internal refactors with no API change |
| `MINOR` | New exports, new optional parameters, new client methods — all backward-compatible |
| `MAJOR` | Anything that breaks existing call sites (see below) |

## What counts as a breaking change (triggers MAJOR)

- Removing or renaming a public export from `sdk/src/index.ts`
- Changing the signature of any public method in a way that requires call-site updates (e.g. adding a required parameter, changing a return type)
- Removing a field from a public interface or type
- Changing the meaning of an existing error code in `errors.ts`
- Dropping support for a `@stellar/stellar-sdk` peer version that was previously supported

## What is NOT a breaking change

- Adding new optional fields to an existing interface
- Adding new exports to `index.ts`
- Adding new methods to an existing client class
- Internal implementation changes that don't affect the public API surface
- Updating devDependencies

## Stable vs. unstable surface

All exports from `sdk/src/index.ts` are considered **stable** and subject to this policy.

The following are **explicitly unstable** and may change in any release:
- `sdk/src/testing/mockRpc.ts` — test harness, not re-exported from the main entry point
- Any file not exported from `index.ts`

## How breaking changes are communicated

1. The `MAJOR` version is bumped in `sdk/package.json`.
2. A `## [X.0.0]` section is added to `CHANGELOG.md` with a `### Breaking Changes` subsection listing every removed/changed API.
3. A migration note is added here under [Migration guides](#migration-guides).
4. The PR description includes a `BREAKING CHANGE:` footer (conventional commits format).

## Example: future breaking change

Suppose `ContractHealth.recentEventCount` is renamed to `eventCount` in a future release:

```
CHANGELOG.md entry:

## [2.0.0] — 2025-xx-xx

### Breaking Changes
- `ContractHealth.recentEventCount` renamed to `eventCount`.
  Update: replace `.recentEventCount` with `.eventCount` at every call site.
```

## Migration guides

_No breaking changes yet — this section will be populated when the first MAJOR bump occurs._

## Finding behavioral migration information

The authoritative record of every SDK change — including behavioral differences between versions — is **[CHANGELOG.md](../CHANGELOG.md)** at the repository root.

Each released version has its own dated section. Breaking changes appear under a `### Breaking Changes` subsection. When upgrading across a `MAJOR` bump, read that subsection first: it lists every removed or renamed API and the corresponding call-site update.

To compare two versions:

1. Open `CHANGELOG.md` and locate the section for the version you are upgrading **from**.
2. Read forward through every section up to and including the version you are upgrading **to**.
3. Any `### Breaking Changes` block in that range requires a call-site update on your end.

The version currently published to the package registry is recorded in [`sdk/package.json`](./package.json) under the `"version"` field. Do not rely on a secondary source; `CHANGELOG.md` and `package.json` are the single source of truth.

## Release process

See [docs/release-process.md](../docs/release-process.md) for the full release workflow (version bump, changelog, tag, GitHub release).
