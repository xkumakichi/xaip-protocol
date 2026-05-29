import * as fs from "fs";
import * as path from "path";
import ts from "typescript";

const repoRoot = path.join(__dirname, "..", "..");

const FILES = {
  docs: path.join(repoRoot, "docs", "precheck-as-tool.md"),
  precheckGuide: path.join(repoRoot, "docs", "precheck.md"),
  plain: path.join(__dirname, "..", "examples", "precheck-tool.plain.ts"),
  langchain: path.join(
    __dirname,
    "..",
    "examples",
    "precheck-tool.langchain.ts"
  ),
};

function read(file: string): string {
  return fs.readFileSync(file, "utf-8");
}

function transpile(source: string, fileName: string): void {
  const result = ts.transpileModule(source, {
    fileName,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      strict: true,
    },
  });

  const errors =
    result.diagnostics?.filter(
      (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error
    ) ?? [];
  expect(errors).toEqual([]);
}

describe("precheck-as-tool examples", () => {
  it("keeps the recipe linked from the main precheck guide", () => {
    expect(read(FILES.precheckGuide)).toContain(
      "[precheck() as a tool recipe](./precheck-as-tool.md)"
    );
  });

  it("documents the recipe boundary and single-operator value", () => {
    const docs = read(FILES.docs);
    expect(docs).toContain(
      "This is a recipe, not a production API surface or a new public SDK API."
    );
    expect(docs).toContain("pre-delegation evidence check");
    expect(docs).toContain("XAIP is not a sandbox.");
    expect(docs).toContain("XAIP is not an approval engine.");
    expect(docs).toContain("XAIP is not a payment rail.");
    expect(docs).toContain("XAIP does not make tools safe.");
    expect(docs).toContain("XAIP does not guarantee trust.");
    expect(docs).toContain(
      "Receipts are primary artifacts; scores and eligibility are derived views."
    );
    expect(docs).toContain(
      "a single operator can use its own execution history"
    );
    expect(docs).toContain(
      "Independent caller diversity can make the evidence graph stronger over time"
    );
  });

  it("keeps examples provider-neutral and syntax-valid", () => {
    const plain = read(FILES.plain);
    const langchain = read(FILES.langchain);

    expect(plain).toContain('import { precheck } from "xaip-sdk"');
    expect(langchain).toContain("DynamicStructuredTool");
    expect(langchain).not.toContain("XAIPCallbackHandler");
    for (const text of [plain, langchain]) {
      expect(text).toContain("tool:translator-alpha");
      expect(text).toContain("skill:translator-beta");
      expect(text).toContain("agent:translator-gamma");
      transpile(text, "example.ts");
    }
  });

  it("does not introduce forbidden claim wording outside allowed boundary text", () => {
    const sources = [
      ["docs/precheck-as-tool.md", read(FILES.docs)],
      ["sdk/examples/precheck-tool.plain.ts", read(FILES.plain)],
      ["sdk/examples/precheck-tool.langchain.ts", read(FILES.langchain)],
    ] as const;

    const forbidden = [
      /\bsafe\s+tool\b/i,
      /\bguaranteed\b/i,
      /\bapproved\b/i,
      /\brecommended\b/i,
      /\bbest\s+tool\b/i,
      /\bverified\s+by\b/i,
      /\bcertified\b/i,
      /\bstandard\b/i,
      /\bgate\b/i,
      /\bblock\b/i,
    ];

    for (const [label, text] of sources) {
      for (const pattern of forbidden) {
        expect(text).not.toMatch(pattern);
      }

      const approvalMatches = text.match(/\bapproval\b/gi) ?? [];
      const allowedApproval =
        label === "docs/precheck-as-tool.md" &&
        approvalMatches.length === 1 &&
        text.includes("XAIP is not an approval engine.");
      expect({
        label,
        approvalMatches,
        allowedApproval,
      }).toEqual(
        approvalMatches.length === 0
          ? { label, approvalMatches: [], allowedApproval: false }
          : { label, approvalMatches: ["approval"], allowedApproval: true }
      );
    }
  });
});
