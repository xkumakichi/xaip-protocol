import { precheck } from "xaip-sdk";

type CompactCandidateEvidence = {
  candidate: string;
  receiptCount: number;
  confidence: number | null;
  riskFlags: string[];
  eligible: boolean;
};

export async function runPlainPrecheckToolExample() {
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

  const evidence: CompactCandidateEvidence[] = result.ranked.map(
    (candidate) => ({
      candidate: candidate.candidate,
      receiptCount: candidate.receiptCount,
      confidence: candidate.confidence,
      riskFlags: candidate.riskFlags,
      eligible: candidate.eligible,
    })
  );

  return {
    selected: result.selected,
    reason: result.reason,
    decision: result.decision ?? "unknown",
    evidence,
  };
}

if (require.main === module) {
  runPlainPrecheckToolExample()
    .then((summary) => {
      console.log(JSON.stringify(summary, null, 2));
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
