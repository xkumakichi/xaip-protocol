/**
 * Static guardrail: precheck.ts and the wording it ships must never contain
 * promotional or trust-asserting language that would conflict with XAIP's
 * "evidence layer, not approval engine" stance.
 *
 * The list below mirrors the public wording guardrail for the precheck API.
 *
 * Notes:
 *   - The single word "trusted" is allowed because it is the existing verdict
 *     band label (see /v1/trust/:slug response). The forbidden phrase is the
 *     composite claim "trusted tool".
 *   - Regexes are case-insensitive with word-boundary checks so they will
 *     catch the claim wherever it appears in code, comments, or JSDoc.
 */

import * as fs from "fs";
import * as path from "path";

const SOURCE_PATH = path.join(__dirname, "..", "src", "precheck.ts");

interface ForbiddenEntry {
  label: string;
  pattern: RegExp;
}

const FORBIDDEN: ForbiddenEntry[] = [
  { label: "best tool", pattern: /\bbest\s+tool\b/i },
  { label: "safe tool", pattern: /\bsafe\s+tool\b/i },
  { label: "trusted tool", pattern: /\btrusted\s+tool\b/i },
  { label: "guaranteed", pattern: /\bguaranteed\b/i },
  { label: "verified by", pattern: /\bverified\s+by\b/i },
  { label: "approved", pattern: /\bapproved\b/i },
  { label: "recommended", pattern: /\brecommended\b/i },
];

describe("precheck source — forbidden wording static guard", () => {
  let source: string;

  beforeAll(() => {
    source = fs.readFileSync(SOURCE_PATH, "utf-8");
  });

  it.each(FORBIDDEN)(
    "must not contain forbidden phrase: $label",
    ({ pattern }) => {
      const match = source.match(pattern);
      if (match) {
        const before = source.slice(Math.max(0, match.index! - 40), match.index!);
        const after = source.slice(
          match.index! + match[0].length,
          match.index! + match[0].length + 40
        );
        throw new Error(
          `Forbidden phrase found near: "...${before}[${match[0]}]${after}..."`
        );
      }
      expect(match).toBeNull();
    }
  );

  it("must not add 'block' to the decision union type", () => {
    // The PrecheckResult.decision union is intentionally allow|warn|unknown.
    // Catch drift like `| "block"` or `"block" |` in a TypeScript union.
    // A JSDoc-style mention of `"block"` in a comment is allowed because the
    // intent there is to document the exclusion, not introduce the value.
    const unionBlock = /(\|\s*"block"|"block"\s*\|)/;
    expect(source).not.toMatch(unionBlock);
  });

  it("REASON constants must be exact strings (no drift)", () => {
    expect(source).toContain(
      'REASON_SELECTED =\n  "Selected using available execution evidence."'
    );
    expect(source).toContain(
      'REASON_NO_ELIGIBLE =\n  "No eligible candidates based on available execution evidence."'
    );
  });
});
