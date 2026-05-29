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

// Example:
// await checkExecutionEvidence.invoke({
//   task: "Translate a product update into Japanese",
//   candidates: [
//     "tool:translator-alpha",
//     "skill:translator-beta",
//     "agent:translator-gamma",
//   ],
// });
