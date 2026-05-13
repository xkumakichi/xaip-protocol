# npm Policy and Supply-Chain Posture

*Last reviewed: 2026-05-14.*

This document records why the repo is configured the way it is, what risks are mitigated, what risks are *not*, and what migration is planned but not yet done.

## Current posture

- Package manager: **npm** (lockfiles: `package-lock.json` in 8 sub-packages).
- CI uses `npm ci` (not `npm install`) so the lockfile is the only allowed dependency resolution.
- Root `.npmrc` sets `engine-strict=true`, `audit-level=moderate`, `save-exact=true`.
- No automated supply-chain blocking beyond what npm provides out of the box.

## What the current settings buy

| Setting | What it prevents |
|---|---|
| `npm ci` in CI | Drift between `package.json` ranges and what actually gets installed. Without it, `npm install` can pull a different version than was tested. |
| `engine-strict=true` | Installs on a Node version not in `engines.node`. Reduces "works on my machine" classes of bug. |
| `audit-level=moderate` | Installs that bring in a package with a known moderate+ vulnerability. Forces visibility, not just a warning. |
| `save-exact=true` | New `npm install <pkg>` writes the exact version into `package.json`, not a caret range. Combined with the lockfile, upgrades become deliberate. |
| Lockfile committed | Reinstalls are deterministic for anyone with the same registry view. |

## What the current settings do **not** buy

These are real gaps. None are mitigated by npm-side configuration. They are why a future migration to pnpm is on the roadmap.

- **Newly published malicious versions.** If a maintained dependency is compromised at the registry and we run `npm install` within the install-script delay, npm will fetch the malicious version. There is no built-in "wait N hours after publish before installing" knob in npm.
- **`postinstall` script injection at any depth.** npm runs lifecycle scripts for all install-time hooks by default. `--ignore-scripts` is all-or-nothing and breaks legitimate native-binary downloads (esbuild, sharp, workerd, protobufjs, unrs-resolver).
- **Transitive version drift between local and CI.** `npm ci` mitigates this only if the lockfile is current. Long-running branches with stale lockfiles can install differently in CI than the developer expected.

## Threat reference (2026-05)

The proximate trigger for this policy is the November 2025 / May 2026 supply-chain wave: TanStack, Mistral, OpenSearch, UiPath, and PyPI packages were compromised via maliciously-injected install scripts. Attacks did not require the consumer to import anything — installation alone executed the payload.

For the design of this repo specifically:

- We use **npm** project-wide (8 sub-packages, mixed lockfiles).
- We have legitimate `postinstall` scripts at `esbuild`, `protobufjs`, `sharp`, `workerd`, `unrs-resolver`. These download native binaries or generate descriptors and are required for the build to work.
- A blanket `ignore-scripts=true` would break the build. Per-package allowlists are not natively supported by npm.

This is why the move to pnpm is on the roadmap — its install-script allowlist (`pnpm.onlyBuiltDependencies`) is the right shape of defense for this codebase.

## Planned migration: pnpm

**Status: deferred.** Attempted on 2026-05-14, surfaced blockers (see below). Reschedule as a focused workstream.

### Why pnpm

- **`minimum-release-age`**: refuse to install a package version published less than N minutes ago. Defangs the install-during-window class of attack.
- **`pnpm.onlyBuiltDependencies`**: per-package allowlist for install scripts. Block by default, allow only the names we recognize.
- **Strict node_modules**: each package gets only what it declares. Undeclared transitive deps fail loudly instead of silently working.
- **Workspace layer (optional)**: deduplicates shared dev deps across the 8 sub-packages.

### Why the 2026-05-14 attempt was deferred

Running `pnpm install` in `sdk/` succeeded, but `pnpm run build` failed with a TypeScript module-resolution error: `Cannot find module 'zod'`. Investigation: `xaip-sdk` imports `zod` directly but does not declare it as a dependency. It works under npm because npm's permissive hoisting flattens `zod` (a transitive dep of `@modelcontextprotocol/sdk`) to the top level. pnpm — even with `node-linker=hoisted` and `shamefully-hoist=true` — does not always do this for transitive deps that no direct dep declares.

This is a latent bug in the npm setup, not a pnpm bug. The fix is to declare `zod` as a direct dep of `xaip-sdk` and re-publish.

The same issue likely affects other packages in the repo. A migration session must:

1. Audit every `import` statement across all 11 `package.json` projects and verify each imported package is declared as a direct dep of the importing project. Tooling: `npx depcheck` per sub-package, or an equivalent ts-morph-based audit.
2. Add missing declarations, bump patch versions of the affected published npm packages.
3. Then run `pnpm install` in each sub-package.
4. Validate: every package builds; every test passes; `npx xaip-caller` smoke-runs; `auto-collect.ts` smoke-runs without posting.
5. Update CI to install pnpm and run `pnpm install --frozen-lockfile`.
6. Update READMEs and CLAUDE.md to reference pnpm in dev instructions (consumer-facing `npm install xaip-sdk` is unaffected and stays).

### Migration sequencing

Recommended ordering, smallest-blast-radius first:

1. `services/aggregator` and `services/trust-api` — private, no npm publish, easiest to validate.
2. `sdk/` — CI-critical (auto-collect runs daily). Validate by running auto-collect locally in dry mode.
3. The published clients (`clients/caller`, `clients/langchain`, `clients/openai`, `clients/claude-code-hook`, `mcp-server-trust`, `mcp-server`) — each may need a patch version bump if direct-dep declarations change.
4. `demo/` and `demo/settlement-demo` — last; they exercise the published packages and validate that the rest of the migration didn't break end-to-end usage.

### Provisional `.npmrc` for pnpm migration

When the migration runs, replace the npm-flavored `.npmrc` with:

```ini
# pnpm baseline
engine-strict=true
auto-install-peers=true
node-linker=hoisted          # only if isolated layout still surfaces type errors after fixing direct-dep declarations
minimum-release-age=1440     # 24h delay before installing newly-published versions
ignore-scripts=true          # block all install scripts; allowlist via package.json
```

Per-package allowlist in each affected `package.json`:

```jsonc
{
  "pnpm": {
    "onlyBuiltDependencies": [
      "esbuild",
      "protobufjs",
      "sharp",
      "workerd",
      "unrs-resolver"
    ]
  }
}
```

The list is the union of legitimate `postinstall` script owners observed at 2026-05-14 across `sdk/`, `services/aggregator/`, `services/trust-api/`. Re-audit before migration; this list will have drifted.

### Decision rule for prioritization

Re-prioritize this migration if any of the following becomes true:

- A direct dep of any sub-package is reported as compromised on the registry.
- A consumer using `xaip-sdk` or any other published client reports installation breakage on a recent registry version.
- Our daily auto-collect run fails because a newly published transitive dep introduced a regression.

Until one of those triggers fires, the npm-side hardening (`npm ci` + this `.npmrc`) is the operating posture.
