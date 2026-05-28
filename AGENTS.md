# AGENTS.md — AI-Assisted Contribution Guide

This file is for AI assistants and maintainers who work on this repository. It defines the public wording boundaries, commit conventions, privacy rules, and verification steps that apply to any change submitted, regardless of which assistant or human authored it.

## 1. Public wording boundaries

These constraints apply to everything that lands in the public tree (README, `docs/`, source comments, error messages, package descriptions, PR descriptions, release notes):

- XAIP is **not a sandbox**.
- XAIP is **not an approval engine**.
- XAIP is **not a payment rail**.
- XAIP **does not make tools safe**.
- XAIP **does not guarantee trust**.
- **Receipts are the primary artifact; scores and eligibility are derived views.**
- The Internet-Draft is an **individual Internet-Draft**. Do not call it an IETF standard, an IETF-approved protocol, or a standardized protocol. It has no formal standing in the IETF standards process.

Avoid these phrasings in any public text:
`best tool`, `safe tool`, `trusted tool`, `guaranteed`, `verified by`, `approved`, `recommended`, `the standard`, `right tool / server / skill`, `payment rail` (except in negation).

## 2. Commit and PR rules

- **Do not add AI-vendor `Co-Authored-By` trailers** to commit messages. Some AI assistants (for example, Claude Code) append these by default; they should be removed before committing.
- **Do not add "Generated with Claude Code" or any similar AI-vendor footer** to PR descriptions.
- Keep commit messages neutral and scoped. One commit = one logical change.
- Privacy-related commit messages must not contain leaked values, personal names, third-party names, or email addresses. Use neutral framing (example: `chore(privacy): remove local agent config from public tree`).

## 3. Privacy rules

- **Do not put personal names, private email addresses, local configuration, credentials, or private strategy notes in any file that lands in the public tree.**
- Local agent configuration files (per-assistant memory, per-IDE settings) must remain untracked. Add them to `.gitignore` rather than committing them.
- Do not embed API keys, tokens, or absolute local paths in committed files.

## 4. Verification before commit

For changes that touch the SDK:

```bash
cd sdk
npm test       # all suites must pass
npm run build  # tsc must succeed
```

For changes that touch public docs or README:

- Grep the touched files for forbidden overclaim wording (see §1).
- Grep the touched files for any specific vendor, company, or marketplace name that is not strictly necessary to the change.

## 5. Where to look

- Spec wire format: [`docs/spec/draft-xkumakichi-xaip-receipts-00.md`](./docs/spec/draft-xkumakichi-xaip-receipts-00.md) (canonical version: IETF Datatracker).
- Public SDK guide: [`docs/precheck.md`](./docs/precheck.md).
- Demos: [`docs/evidence-before-delegation.html`](./docs/evidence-before-delegation.html), [`docs/before-payment-demo.html`](./docs/before-payment-demo.html).
- Repository root: [`README.md`](./README.md).

---

Changes that violate the rules in this file should be revised before merge, regardless of the AI assistant or human author that produced them.
