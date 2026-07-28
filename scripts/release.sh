#!/usr/bin/env bash
# scripts/release.sh — Veritoken release automation
#
# Usage:
#   bash scripts/release.sh <version>
#   bash scripts/release.sh 0.2.0
#
# What this script does:
#   1. Validates the version string and that the repo is clean.
#   2. Bumps the version in every contracts/*/Cargo.toml and the root Cargo.lock.
#   3. Generates a changelog entry for the new version from unreleased items.
#   4. Commits the version bump and changelog update.
#   5. Tags the commit vX.Y.Z.
#   6. Prints next steps (push + create GitHub release).
#
# The script does NOT push or create the GitHub release automatically.
# A human must review the commit, then run:
#   git push origin main && git push origin vX.Y.Z
#
# Requirements: git, sed, cargo

set -euo pipefail

# ── Helpers ──────────────────────────────────────────────────────────────────

usage() {
  echo "Usage: bash scripts/release.sh <version>"
  echo "  version  Semantic version without leading 'v', e.g. 0.2.0"
  exit 1
}

die() { echo "ERROR: $*" >&2; exit 1; }

# ── Input validation ──────────────────────────────────────────────────────────

[ "${1:-}" ] || usage

VERSION="$1"
TAG="v${VERSION}"

# Must match X.Y.Z (optionally X.Y.Z-label)
if ! echo "$VERSION" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9._-]+)?$'; then
  die "Version '$VERSION' is not a valid semver string (expected X.Y.Z or X.Y.Z-label)"
fi

# ── Repo hygiene ──────────────────────────────────────────────────────────────

# Must be run from the repo root
[ -f "Cargo.toml" ] || die "Run this script from the repository root"

# Working tree must be clean
if ! git diff --quiet || ! git diff --cached --quiet; then
  die "Working tree is not clean. Commit or stash your changes before releasing."
fi

# Tag must not already exist
if git tag | grep -qxF "$TAG"; then
  die "Tag $TAG already exists."
fi

echo ""
echo "==> Preparing release $TAG"
echo ""

# ── Bump version in Cargo manifests ──────────────────────────────────────────

echo "--- Bumping version in contracts/*/Cargo.toml..."

for manifest in contracts/*/Cargo.toml; do
  # Replace the first `version = "..."` line in each manifest (the package version)
  sed -i "0,/^version = \".*\"/{s/^version = \".*\"/version = \"${VERSION}\"/}" "$manifest"
  echo "    updated: $manifest"
done

# Regenerate the lockfile to capture the new versions
echo "--- Updating Cargo.lock..."
cargo update --workspace --quiet

# ── Generate changelog entry ──────────────────────────────────────────────────

TODAY=$(date -u +%Y-%m-%d)
CHANGELOG="CHANGELOG.md"

echo "--- Generating changelog entry for $TAG ($TODAY)..."

# Extract the [Unreleased] section content (everything between [Unreleased] and the next [X.Y.Z] heading)
UNRELEASED_CONTENT=$(awk '/^## \[Unreleased\]/{found=1; next} found && /^## \[/{exit} found{print}' "$CHANGELOG")

if [ -z "$(echo "$UNRELEASED_CONTENT" | tr -d '[:space:]')" ]; then
  die "The [Unreleased] section in CHANGELOG.md is empty. Add entries before releasing."
fi

# Build the new version section
NEW_SECTION="## [${VERSION}] — ${TODAY}
${UNRELEASED_CONTENT}"

# Build the new [Unreleased] section (empty, ready for next cycle)
NEW_UNRELEASED="## [Unreleased]

"

# Append the new comparison link to the bottom of the file
REPO_URL="https://github.com/abore9769/Veritoken"

# Find the previous version by looking at the last [X.Y.Z] heading
PREV_VERSION=$(grep -oP '(?<=## \[)[0-9]+\.[0-9]+\.[0-9]+(?=\])' "$CHANGELOG" | head -1 || echo "")

# Rewrite the changelog:
#   - Replace [Unreleased] section with an empty one + the new version section
#   - Update the [Unreleased] comparison link
python3 - <<PYEOF
import re, sys

with open("${CHANGELOG}") as f:
    content = f.read()

# Replace the [Unreleased] block content with empty + new version block
unreleased_pattern = r'(## \[Unreleased\])(.*?)(?=\n## \[|\Z)'
new_unreleased = '## [Unreleased]\n\n'
new_version_block = '## [${VERSION}] \u2014 ${TODAY}\n${UNRELEASED_CONTENT}'

content = re.sub(unreleased_pattern, new_unreleased + new_version_block, content, flags=re.DOTALL)

# Update or add the [Unreleased] comparison link at the bottom
prev = '${PREV_VERSION}'
ver = '${VERSION}'
repo = '${REPO_URL}'

unreleased_link = f'[Unreleased]: {repo}/compare/v{ver}...HEAD'
version_link = f'[{ver}]: {repo}/compare/v{prev}...v{ver}'

# Replace existing [Unreleased] link
if re.search(r'^\[Unreleased\]:', content, re.MULTILINE):
    content = re.sub(r'^\[Unreleased\]:.*$', unreleased_link, content, flags=re.MULTILINE)
else:
    content = content.rstrip() + '\n' + unreleased_link + '\n'

# Add the new version link after the [Unreleased] link if not already present
if f'[{ver}]:' not in content:
    content = re.sub(
        r'(\[Unreleased\]:.*\n)',
        r'\1' + version_link + '\n',
        content
    )

with open("${CHANGELOG}", 'w') as f:
    f.write(content)

print("    Changelog updated.")
PYEOF

# ── Commit and tag ────────────────────────────────────────────────────────────

echo "--- Creating release commit..."

git add contracts/*/Cargo.toml Cargo.lock "$CHANGELOG"

git commit -m "chore: release ${TAG}

- Bump contract versions to ${VERSION}
- Update CHANGELOG.md with release notes for ${TAG}"

echo "--- Tagging $TAG..."
git tag -a "$TAG" -m "Release ${TAG}"

# ── Summary ───────────────────────────────────────────────────────────────────

echo ""
echo "==> Release $TAG prepared successfully."
echo ""
echo "Next steps:"
echo "  1. Review the commit: git show HEAD"
echo "  2. Review the changelog: cat CHANGELOG.md"
echo "  3. Push the commit and tag:"
echo "       git push origin main"
echo "       git push origin $TAG"
echo "  4. Create a GitHub release from the tag and paste the changelog entry."
echo ""
echo "To undo (before pushing): git tag -d $TAG && git reset --hard HEAD~1"
echo ""
