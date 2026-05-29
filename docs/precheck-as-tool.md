# precheck() As A Tool Recipe

This is a recipe, not a production API surface or a new public SDK API. It shows how an application can expose `xaip-sdk` `precheck()` as a pre-delegation evidence check that an agent or router can call before choosing a tool, skill, or agent.

`precheck()` returns available execution evidence before delegation. The caller or agent remains responsible for its own policy decision, routing behavior, fallback behavior, and user experience.

## Why Use This Pattern

Agents often see candidate names, descriptions, prices, or local config entries before they act. That is useful metadata, but it is not execution history.

`precheck()` lets an application ask for available execution evidence first:

- which candidates have receipts
- which candidates are unscored
- which candidates carry risk flags
- which candidates remain eligible under the caller's local policy
- the optional derived `decision` value: `allow`, `warn`, or `unknown`

Even before a network forms, a single operator can use its own execution history to inform future delegation decisions. Independent caller diversity can make the evidence graph stronger over time, but it should be treated as an accumulating property of the graph, not as something this recipe completes by itself.

## Boundary

XAIP is not a sandbox.
XAIP is not an approval engine.
XAIP is not a payment rail.
XAIP does not make tools safe.
XAIP does not guarantee trust.
Receipts are primary artifacts; scores and eligibility are derived views.

This pattern does not execute tools, make payments, or emit receipts. Receipt emission remains a separate after-execution path.

## Plain TypeScript

The direct form is useful when your router or agent loop is already TypeScript code.
These examples assume an application project that already depends on `xaip-sdk`.

```typescript
import { precheck } from "xaip-sdk";

const result = await precheck({
  task: "Translate a product update into Japanese",
  candidates: [
    "tool:translator-alpha",
    "skill:translator-beta",
    "agent:translator-gamma",
  ],
  policy: {
    minReceipts: 10,
    excludeRiskFlags: ["repeated_timeout"],
    timeoutMs: 5000,
    mode: "strict",
  },
  includeDecision: true,
});

console.log({
  selected: result.selected,
  reason: result.reason,
  decision: result.decision,
  evidence: result.ranked.map((candidate) => ({
    candidate: candidate.candidate,
    receiptCount: candidate.receiptCount,
    confidence: candidate.confidence,
    riskFlags: candidate.riskFlags,
    eligible: candidate.eligible,
  })),
});
```

The matching example file is [`sdk/examples/precheck-tool.plain.ts`](../sdk/examples/precheck-tool.plain.ts).

## LangChain DynamicStructuredTool

LangChain callbacks observe tool execution after a tool has already been chosen. Do not use a callback-only path when the application needs a pre-delegation evidence check.

Instead, expose `precheck()` as a `DynamicStructuredTool` that the agent can call before choosing among candidates.

```typescript
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { precheck } from "xaip-sdk";

export const checkExecutionEvidence = new DynamicStructuredTool({
  name: "check_execution_evidence",
  description:
    "Check available execution evidence for candidate tools, skills, or agents before delegation. The caller keeps responsibility for policy decisions.",
  schema: z.object({
    task: z.string().min(1),
    candidates: z.array(z.string().min(1)).min(1),
  }),
  func: async ({ task, candidates }) => {
    const result = await precheck({
      task,
      candidates,
      policy: {
        minReceipts: 10,
        excludeRiskFlags: ["repeated_timeout"],
        timeoutMs: 5000,
        mode: "strict",
      },
      includeDecision: true,
    });

    return JSON.stringify({
      selected: result.selected,
      reason: result.reason,
      decision: result.decision ?? "unknown",
      evidence: result.ranked.map((candidate) => ({
        candidate: candidate.candidate,
        receiptCount: candidate.receiptCount,
        confidence: candidate.confidence,
        riskFlags: candidate.riskFlags,
        eligible: candidate.eligible,
      })),
    });
  },
});
```

The matching example file is [`sdk/examples/precheck-tool.langchain.ts`](../sdk/examples/precheck-tool.langchain.ts).

This recipe requires the application to provide its normal LangChain dependencies such as `@langchain/core` and `zod`. The XAIP SDK does not add those dependencies.
