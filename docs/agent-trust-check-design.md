# Agent Trust Check Design

## 1. Purpose

Agent Trust Check is a future web diagnostic tool that helps builders understand how much XAIP trust evidence exists for the tools an AI agent may call.

It should make one question easy to answer:

> Before this agent chooses a tool, what behavior-derived XAIP evidence is available?

The tool is not a security audit, a production guarantee, or a claim that any tool is safe. It reports available XAIP trust evidence and highlights trust coverage gaps.

## 2. Target Users

- AI-native builders who connect agents to tools but do not want to inspect raw API responses.
- Developers choosing between tool providers, MCP servers, HTTP tools, or framework integrations.
- Architects evaluating whether a workflow has enough portable trust evidence before automation expands.
- Contributors who want to see where more signed receipts would improve the trust graph.

## 3. Core User Story

As a builder, I paste a list of tools my agent may use. Agent Trust Check shows which tools have XAIP evidence, which are unscored, and what the available trust labels mean, so I can decide whether to proceed, add receipts, or use another review process.

## 4. Non-Goals

- Do not execute tools.
- Do not post receipts.
- Do not create new trust scores.
- Do not certify tools as safe.
- Do not replace security review, vendor review, legal review, or production monitoring.
- Do not claim real-world success-rate improvement.
- Do not rank platforms, vendors, or ecosystems.

## 5. Minimal Input Format

The first version should accept a small list of candidate tool identifiers.

```json
{
  "tools": [
    { "name": "context7", "type": "mcp" },
    { "name": "internal-docs-search", "type": "http" },
    { "name": "filesystem", "type": "mcp" }
  ]
}
```

Only `name` should be required. `type` can help explain coverage, but the diagnostic should not depend on MCP-specific fields.

## 6. Minimal Output Format

The output should be understandable as a table and serializable as JSON.

```json
{
  "summary": {
    "totalTools": 3,
    "scoredTools": 2,
    "unscoredTools": 1,
    "trustCoverage": 0.67
  },
  "tools": [
    {
      "name": "context7",
      "xaipEvidence": "available",
      "riskLabel": "caution",
      "trust": 0.654,
      "receiptCount": 585,
      "reason": "XAIP has behavior-derived receipts for this tool."
    },
    {
      "name": "internal-docs-search",
      "xaipEvidence": "none_yet",
      "riskLabel": "no_xaip_evidence",
      "reason": "No XAIP evidence yet. This does not mean unsafe."
    }
  ]
}
```

The tool should display the coverage result even when most tools are unscored. That is still useful: it shows where the trust graph has evidence and where it does not.

## 7. Risk Labels

Use plain labels that map to existing XAIP evidence.

- `trusted`: XAIP has scored evidence and the current verdict is trusted.
- `caution`: XAIP has scored evidence, but the result should be reviewed with care.
- `low_trust`: XAIP has scored evidence and the current verdict is low trust.
- `no_xaip_evidence`: the tool is not present in the current XAIP trust data.

The UI should avoid implying that `trusted` means safe or approved. It means the current XAIP score and verdict are favorable relative to the available receipt data.

## 8. How To Handle Unscored Tools

Unscored tools should be reported as:

> No XAIP evidence yet.

They should not be labeled unsafe. They should not be hidden. The diagnostic should explain that an unscored result may happen because the tool has not emitted receipts, has not been called by known receipt producers, or is outside the current public dataset.

The current public dataset is MCP-heavy because MCP was the first integration target. Provider-neutral receipt producers such as HTTP callers and framework integrations can expand coverage over time.

## 9. What The Tool Can Say

- "XAIP has behavior-derived receipts for this tool."
- "This tool is currently unscored in XAIP."
- "Trust coverage for this candidate set is 2 of 3 tools."
- "This verdict is based on the current public trust API response."
- "This result should be combined with your normal security, reliability, and vendor review."
- "The current public dataset is MCP-heavy because MCP was the first integration target."

## 10. What The Tool Must Not Say

- "This tool is safe."
- "This tool is secure."
- "This tool is production-ready."
- "XAIP guarantees this tool will work."
- "Unscored means unsafe."
- "Trusted means approved."
- "This is a security audit."
- "This proves real-world success-rate improvement."
- "This proves one framework or platform is better than another."

## 11. API Dependencies

Use existing public XAIP API surfaces only.

- `/v1/trust?slugs=...`: batch lookup for pasted candidate identifiers.
- `/v1/trust/:slug`: single-tool drilldown if needed.
- `/v1/servers`: optional list of currently scored tools for autocomplete or examples.
- `/v1/select`: optional comparison view, clearly labeled as trust-informed selection, not execution proof.

The design should not require new endpoints for the first version.

## 12. Future UI Concept

The first UI can be a single-page diagnostic:

1. Text area for tool names, one per line.
2. Optional type selector per tool: MCP, HTTP, LangChain, OpenAI tool, other, unknown.
3. "Check trust evidence" button.
4. Summary panel showing trust coverage.
5. Results table with tool name, XAIP evidence, verdict, receipt count, risk flags, and plain-language reason.
6. Explanation panel that defines each label and repeats the non-goals.
7. Copyable JSON result for developers.

The page should work even if every input tool is unscored. In that case, the primary result is a coverage gap, not a failure.

## 13. Safety And Anti-Overclaiming Rules

- Always describe results as XAIP evidence, not absolute truth.
- Show receipt counts or "no evidence yet" near every verdict.
- Keep the current public dataset limitation visible.
- Avoid "safe", "secure", "certified", "approved", and "guaranteed".
- Explain that trust scores are historical behavior-derived evidence.
- Keep unscored tools neutral.
- Make clear that active execution results, security review, and production monitoring are separate concerns.

## 14. Future Extensions

- Upload a tool manifest or agent config file.
- Compare blind selection against trust-informed selection for the user's candidate set.
- Add static snapshots for reproducible reports.
- Add cross-framework fixtures once enough non-MCP receipt data exists.
- Show caller diversity and freshness of receipts.
- Generate a shareable diagnostic report.
- Let contributors see which unscored tools would benefit from external receipt runs.
