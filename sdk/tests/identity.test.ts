import {
  parseDID,
  generateDIDKey,
  createSigningDelegate,
  sign,
  verify,
  hash,
  receiptPayload,
} from "../src/identity";

describe("parseDID", () => {
  it("parses did:key", () => {
    const did = parseDID("did:key:abc123");
    expect(did.method).toBe("key");
    expect(did.id).toBe("did:key:abc123");
  });

  it("parses did:web", () => {
    const did = parseDID("did:web:myagent.example.com");
    expect(did.method).toBe("web");
    expect(did.id).toBe("did:web:myagent.example.com");
  });

  it("parses did:xrpl", () => {
    const did = parseDID("did:xrpl:rSomeAddress");
    expect(did.method).toBe("xrpl");
  });

  it("parses did:ethr", () => {
    const did = parseDID("did:ethr:0xABC");
    expect(did.method).toBe("ethr");
  });

  it("throws on invalid DID format", () => {
    expect(() => parseDID("not-a-did")).toThrow("Invalid DID");
  });

  it("accepts unknown DID methods", () => {
    const did = parseDID("did:pkh:solana123");
    expect(did.method).toBe("pkh");
    expect(did.id).toBe("did:pkh:solana123");
  });

  it("does not have a weight property", () => {
    const did = parseDID("did:key:abc");
    expect(did).not.toHaveProperty("weight");
  });
});

describe("generateDIDKey", () => {
  it("generates a valid did:key", () => {
    const { did, publicKey, privateKey } = generateDIDKey();
    expect(did.method).toBe("key");
    expect(did.id).toMatch(/^did:key:/);
    expect(publicKey.length).toBeGreaterThan(0);
    expect(privateKey.length).toBeGreaterThan(0);
  });

  it("generates unique DIDs each time", () => {
    const a = generateDIDKey();
    const b = generateDIDKey();
    expect(a.did.id).not.toBe(b.did.id);
  });
});

describe("sign / verify", () => {
  const { publicKey, privateKey } = generateDIDKey();
  const data = "test payload data";

  it("produces a valid signature", () => {
    const sig = sign(data, privateKey);
    expect(sig.length).toBeGreaterThan(0);
    expect(verify(data, sig, publicKey)).toBe(true);
  });

  it("rejects tampered data", () => {
    const sig = sign(data, privateKey);
    expect(verify("tampered", sig, publicKey)).toBe(false);
  });

  it("rejects wrong key", () => {
    const other = generateDIDKey();
    const sig = sign(data, privateKey);
    expect(verify(data, sig, other.publicKey)).toBe(false);
  });
});

describe("receiptPayload (JCS / RFC 8785)", () => {
  it("produces deterministic canonical JSON", () => {
    const payload = receiptPayload({
      agentDid: "did:key:abc",
      toolName: "translate",
      taskHash: "h1",
      resultHash: "h2",
      success: true,
      latencyMs: 142,
      timestamp: "2026-04-12T00:00:00Z",
    });
    // JCS sorts keys lexicographically
    const parsed = JSON.parse(payload);
    const keys = Object.keys(parsed);
    expect(keys).toEqual([...keys].sort());
    expect(parsed.agentDid).toBe("did:key:abc");
    expect(parsed.toolName).toBe("translate");
    expect(parsed.success).toBe(true);
  });

  it("is deterministic across calls", () => {
    const receipt = {
      agentDid: "did:key:abc",
      toolName: "translate",
      taskHash: "h1",
      resultHash: "h2",
      success: true,
      latencyMs: 142,
      timestamp: "2026-04-12T00:00:00Z",
    };
    expect(receiptPayload(receipt)).toBe(receiptPayload(receipt));
  });

  it("includes callerDid when present", () => {
    const payload = receiptPayload({
      agentDid: "did:key:abc",
      callerDid: "did:web:caller.com",
      toolName: "translate",
      taskHash: "h1",
      resultHash: "h2",
      success: true,
      latencyMs: 100,
      timestamp: "2026-04-12T00:00:00Z",
    });
    const parsed = JSON.parse(payload);
    expect(parsed.callerDid).toBe("did:web:caller.com");
  });

  it("defaults callerDid to empty string when absent", () => {
    const payload = receiptPayload({
      agentDid: "did:key:abc",
      toolName: "translate",
      taskHash: "h1",
      resultHash: "h2",
      success: true,
      latencyMs: 100,
      timestamp: "2026-04-12T00:00:00Z",
    });
    const parsed = JSON.parse(payload);
    expect(parsed.callerDid).toBe("");
  });

  it("includes failureType when present", () => {
    const payload = receiptPayload({
      agentDid: "did:key:abc",
      toolName: "code-gen",
      taskHash: "h1",
      resultHash: "",
      success: false,
      latencyMs: 31000,
      failureType: "timeout",
      timestamp: "2026-04-12T00:00:00Z",
    });
    const parsed = JSON.parse(payload);
    expect(parsed.failureType).toBe("timeout");
  });

  it("co-signature: same payload signed by two keys produces different sigs", () => {
    const executor = generateDIDKey();
    const caller = generateDIDKey();
    const payload = receiptPayload({
      agentDid: executor.did.id,
      callerDid: caller.did.id,
      toolName: "translate",
      taskHash: "h1",
      resultHash: "h2",
      success: true,
      latencyMs: 100,
      timestamp: "2026-04-12T00:00:00Z",
    });

    const execSig = sign(payload, executor.privateKey);
    const callerSig = sign(payload, caller.privateKey);

    expect(execSig).not.toBe(callerSig);
    expect(verify(payload, execSig, executor.publicKey)).toBe(true);
    expect(verify(payload, callerSig, caller.publicKey)).toBe(true);
    // Cross-verify should fail
    expect(verify(payload, execSig, caller.publicKey)).toBe(false);
  });

  // ─── JCS RFC 8785 Conformance ──────────────────────
  it("JCS: numbers serialize without trailing zeros", () => {
    const payload = receiptPayload({
      agentDid: "did:key:abc",
      toolName: "test",
      taskHash: "h",
      resultHash: "r",
      success: true,
      latencyMs: 100,
      timestamp: "2026-01-01T00:00:00Z",
    });
    // latencyMs=100 should appear as 100, not 100.0
    expect(payload).toContain('"latencyMs":100');
  });

  it("JCS: boolean values are lowercase", () => {
    const payloadTrue = receiptPayload({
      agentDid: "did:key:abc",
      toolName: "test",
      taskHash: "h",
      resultHash: "r",
      success: true,
      latencyMs: 50,
      timestamp: "2026-01-01T00:00:00Z",
    });
    const payloadFalse = receiptPayload({
      agentDid: "did:key:abc",
      toolName: "test",
      taskHash: "h",
      resultHash: "r",
      success: false,
      latencyMs: 50,
      timestamp: "2026-01-01T00:00:00Z",
    });
    expect(payloadTrue).toContain('"success":true');
    expect(payloadFalse).toContain('"success":false');
  });

  it("JCS: strings with special chars are properly escaped", () => {
    const payload = receiptPayload({
      agentDid: 'did:key:abc"def',
      toolName: "test",
      taskHash: "h",
      resultHash: "r",
      success: true,
      latencyMs: 50,
      timestamp: "2026-01-01T00:00:00Z",
    });
    expect(payload).toContain('"agentDid":"did:key:abc\\"def"');
  });

  it("JCS: no whitespace in output", () => {
    const payload = receiptPayload({
      agentDid: "did:key:abc",
      toolName: "translate",
      taskHash: "h1",
      resultHash: "h2",
      success: true,
      latencyMs: 100,
      timestamp: "2026-01-01T00:00:00Z",
    });
    // No spaces after colons or commas
    expect(payload).not.toMatch(/: /);
    expect(payload).not.toMatch(/, /);
  });
});

describe("createSigningDelegate", () => {
  it("creates a delegate that signs correctly", async () => {
    const { did, publicKey, privateKey } = generateDIDKey();
    const delegate = createSigningDelegate(did.id, privateKey);

    expect(delegate.did).toBe(did.id);
    const sig = await delegate.sign("test payload");
    expect(verify("test payload", sig, publicKey)).toBe(true);
  });

  it("key never leaves delegate (no publicKey/privateKey exposed)", () => {
    const { did, privateKey } = generateDIDKey();
    const delegate = createSigningDelegate(did.id, privateKey);
    // Only `did` and `sign` are on the interface
    expect(Object.keys(delegate).sort()).toEqual(["did", "sign"]);
  });
});

describe("hash", () => {
  it("returns 16 hex chars", () => {
    const h = hash({ foo: "bar" });
    expect(h).toHaveLength(16);
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is deterministic", () => {
    expect(hash("test")).toBe(hash("test"));
  });

  it("differs for different inputs", () => {
    expect(hash("a")).not.toBe(hash("b"));
  });
});
