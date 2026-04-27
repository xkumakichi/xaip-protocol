import { generateDIDKey, hash, verify } from "xaip-sdk";
import type { ExecutionReceipt } from "xaip-sdk";
// sign and receiptPayload are existing SDK helpers, but are not exported by the package index.
import { receiptPayload, sign } from "../sdk/src/identity";

const DEFAULT_AGGREGATOR = "https://xaip-aggregator.kuma-github.workers.dev";

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function main(): Promise<void> {
  const shouldPost = hasFlag("--post") || process.env.XAIP_POST === "1";
  const aggregatorUrl = (
    process.env.XAIP_AGGREGATOR_URL || DEFAULT_AGGREGATOR
  ).replace(/\/$/, "");

  const agent = generateDIDKey();
  const caller = generateDIDKey();

  const base: Omit<ExecutionReceipt, "signature" | "callerSignature"> = {
    agentDid: agent.did.id,
    callerDid: caller.did.id,
    toolName: "demo/v05-metadata-smoke",
    taskHash: hash({
      task: "Create a v0.5 receipt carrying display-only metadata",
    }),
    resultHash: hash({
      ok: true,
      note: "metadata is signed but not used for scoring in this demo",
    }),
    success: true,
    latencyMs: 12,
    timestamp: new Date().toISOString(),
    toolMetadata: {
      xaip: {
        class: "settlement",
        verifiabilityHint: "anchored",
        settlementLayer: "xrpl-testnet",
      },
    },
  };

  const payload = receiptPayload(base);
  const receipt: ExecutionReceipt = {
    ...base,
    signature: sign(payload, agent.privateKey),
    callerSignature: sign(payload, caller.privateKey),
  };

  const agentVerified = verify(payload, receipt.signature, agent.publicKey);
  const callerVerified = verify(payload, receipt.callerSignature!, caller.publicKey);

  console.log("XAIP v0.5 toolMetadata smoke");
  console.log(`mode: ${shouldPost ? "post" : "dry-run"}`);
  console.log(`agentDid: ${receipt.agentDid}`);
  console.log(`callerDid: ${receipt.callerDid}`);
  console.log(`toolMetadata.xaip.class: ${receipt.toolMetadata?.xaip?.class}`);
  console.log(
    `toolMetadata.xaip.verifiabilityHint: ${receipt.toolMetadata?.xaip?.verifiabilityHint}`
  );
  console.log(
    `toolMetadata.xaip.settlementLayer: ${receipt.toolMetadata?.xaip?.settlementLayer}`
  );
  console.log(`agent signature verifies: ${agentVerified}`);
  console.log(`caller signature verifies: ${callerVerified}`);
  console.log(
    "metadata note: display-only; it does not affect current scoring or /v1/select behavior"
  );

  if (!agentVerified || !callerVerified) {
    throw new Error("signature verification failed");
  }

  if (!shouldPost) {
    console.log("dry-run: receipt was not posted");
    console.log("set XAIP_POST=1 or pass --post to submit to an aggregator");
    return;
  }

  console.log(`posting to: ${aggregatorUrl}/receipts`);
  console.log(
    "posting note: submitted metadata is display-only and does not affect current scoring or /v1/select behavior"
  );

  const response = await fetch(`${aggregatorUrl}/receipts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      receipt,
      publicKey: agent.publicKey,
      callerPublicKey: caller.publicKey,
    }),
  });

  const text = await response.text();
  console.log(`post status: ${response.status}`);
  console.log(text);

  if (!response.ok) {
    throw new Error("receipt post failed");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});

