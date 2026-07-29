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

## Release process

See [docs/release-process.md](../docs/release-process.md) for the full release workflow (version bump, changelog, tag, GitHub release).
