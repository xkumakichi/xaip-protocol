# Emit XAIP Receipts From Anything

If your tool system has hashable input and output, it can emit XAIP receipts.

XAIP is a provider-neutral receipt layer for AI agent tool execution. MCP, LangChain, OpenAI tool calling, HTTP callers, and proprietary tool runtimes can all produce the same kind of receipt. Packages such as `xaip-claude-hook`, `xaip-langchain`, `xaip-openai`, `xaip-caller`, and `xaip-sdk` are convenience receipt producers. They are not the protocol boundary.

The portable core is:

- canonical input/output hashing
- Ed25519 signing
- optional caller co-signing
- aggregator submission
- scoring from behavior-derived receipts

## Minimal Flow

1. Canonicalize the tool input.
2. Hash the canonicalized input.
3. Run the tool.
4. Canonicalize the tool output.
5. Hash the canonicalized output.
6. Determine whether the execution succeeded.
7. Measure `latencyMs`.
8. Create a receipt.
9. Sign the canonical receipt payload with Ed25519.
10. Optionally co-sign the same payload with the caller key.
11. Submit the receipt to an aggregator.

## Minimal Receipt Fields

The portable receipt signal is:

- `agentDid`
- `callerDid`
- `taskHash`
- `resultHash`
- `success`
- `latencyMs`
- `timestamp`

The current aggregator endpoint also requires `toolName`, `signature`, and the agent `publicKey` in the POST body. `callerSignature` and `callerPublicKey` are optional but recommended when the caller can co-sign.

## Minimal TypeScript Example

This example uses the current receipt shape and Node's built-in crypto APIs. It does not depend on MCP, LangChain, OpenAI, or any provider SDK.

```ts
import crypto from "node:crypto";

type KeyPair = {
  did: string;
  publicKey: string;  // SPKI DER hex
  privateKey: string; // PKCS8 DER hex
};

function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite numbers are not canonical JSON");
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;

  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((key) => {
    return `${JSON.stringify(key)}:${canonicalize(obj[key])}`;
  }).join(",")}}`;
}

function sha256short(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function signEd25519(payload: string, privateKeyHex: string): string {
  const key = crypto.createPrivateKey({
    key: Buffer.from(privateKeyHex, "hex"),
    format: "der",
    type: "pkcs8",
  });
  return crypto.sign(null, Buffer.from(payload), key).toString("hex");
}

function receiptPayload(receipt: {
  agentDid: string;
  callerDid?: string;
  failureType?: string;
  latencyMs: number;
  resultHash?: string;
  success: boolean;
  taskHash: string;
  timestamp: string;
  toolName: string;
}): string {
  return canonicalize({
    agentDid: receipt.agentDid,
    callerDid: receipt.callerDid ?? "",
    failureType: receipt.failureType ?? "",
    latencyMs: receipt.latencyMs,
    resultHash: receipt.resultHash ?? "",
    success: receipt.success,
    taskHash: receipt.taskHash,
    timestamp: receipt.timestamp,
    toolName: receipt.toolName,
  });
}

async function runWithXAIPReceipt<TInput, TOutput>(params: {
  toolName: string;
  input: TInput;
  run: (input: TInput) => Promise<TOutput>;
  agent: KeyPair;
  caller?: KeyPair;
  aggregatorUrl: string;
}): Promise<TOutput> {
  const started = Date.now();
  const taskHash = sha256short(canonicalize(params.input));

  async function submit(base: {
    agentDid: string;
    callerDid?: string;
    toolName: string;
    taskHash: string;
    resultHash: string;
    success: boolean;
    latencyMs: number;
    failureType?: string;
    timestamp: string;
  }) {
    const payload = receiptPayload(base);
    const receipt = {
      ...base,
      signature: signEd25519(payload, params.agent.privateKey),
      callerSignature: params.caller
        ? signEd25519(payload, params.caller.privateKey)
        : undefined,
    };

    await fetch(`${params.aggregatorUrl.replace(/\/$/, "")}/receipts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        receipt,
        publicKey: params.agent.publicKey,
        callerPublicKey: params.caller?.publicKey,
      }),
    });
  }

  try {
    const output = await params.run(params.input);
    const latencyMs = Date.now() - started;

    await submit({
      agentDid: params.agent.did,
      callerDid: params.caller?.did,
      toolName: params.toolName,
      taskHash,
      resultHash: sha256short(canonicalize(output)),
      success: true,
      latencyMs,
      timestamp: new Date().toISOString(),
    });

    return output;
  } catch (error) {
    await submit({
      agentDid: params.agent.did,
      callerDid: params.caller?.did,
      toolName: params.toolName,
      taskHash,
      resultHash: "",
      success: false,
      latencyMs: Date.now() - started,
      failureType: "error",
      timestamp: new Date().toISOString(),
    });

    throw error;
  }
}
```

For production use, persist agent and caller keys instead of generating fresh identities on every process start. If you use `xaip-sdk` directly, prefer its public APIs where they fit your integration. The root package exports higher-level helpers such as `withXAIP`, `generateDIDKey`, `createSigningDelegate`, and `hash`; the low-level signing payload helper is not currently exposed as a root-level public API.

## Minimal HTTP Submission

The current aggregator accepts `POST /receipts` with this body shape:

```json
{
  "receipt": {
    "agentDid": "did:web:example-tool",
    "callerDid": "did:key:...",
    "toolName": "search",
    "taskHash": "abc123...",
    "resultHash": "def456...",
    "success": true,
    "latencyMs": 42,
    "timestamp": "2026-04-24T00:00:00.000Z",
    "signature": "<agent Ed25519 signature hex>",
    "callerSignature": "<optional caller Ed25519 signature hex>"
  },
  "publicKey": "<agent SPKI public key hex>",
  "callerPublicKey": "<optional caller SPKI public key hex>"
}
```

```bash
curl -X POST "https://xaip-aggregator.kuma-github.workers.dev/receipts" \
  -H "Content-Type: application/json" \
  -d @receipt.json
```

The aggregator verifies the agent signature before storing the receipt. If `callerDid` and `callerSignature` are present, it also verifies the caller signature when it can derive or receive the caller public key.

## Security Notes

- Never sign raw secrets, prompts, credentials, API tokens, or private user data.
- Hash sensitive payloads before they leave the process.
- Use stable canonical JSON for hashes and signing payloads.
- Clock and timestamp correctness matters. The current aggregator rejects receipts that are too old or too far in the future.
- Caller diversity matters. Receipts from many independent callers are stronger evidence than receipts dominated by one caller.
- Success criteria should be explicit. Decide what counts as success before emitting receipts, especially for partial failures, retries, HTTP non-2xx responses, and tool-specific errors.
