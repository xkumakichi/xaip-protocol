import { ReceiptStore } from "../src/store";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";

function tmpDbPath(): string {
  return path.join(os.tmpdir(), `xaip-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

describe("ReceiptStore", () => {
  let store: ReceiptStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = tmpDbPath();
    store = new ReceiptStore(dbPath);
  });

  afterEach(async () => {
    await store.close();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  describe("keys", () => {
    it("saves and loads keys", async () => {
      await store.saveKeys("did:key:test", "pub123", "priv456");
      const keys = await store.getKeys("did:key:test");
      expect(keys).toEqual({ publicKey: "pub123", privateKey: "priv456" });
    });

    it("returns null for unknown DID", async () => {
      const keys = await store.getKeys("did:key:unknown");
      expect(keys).toBeNull();
    });

    it("overwrites keys on re-save", async () => {
      await store.saveKeys("did:key:test", "pub1", "priv1");
      await store.saveKeys("did:key:test", "pub2", "priv2");
      const keys = await store.getKeys("did:key:test");
      expect(keys!.publicKey).toBe("pub2");
    });
  });

  describe("receipts", () => {
    const receipt = {
      agentDid: "did:key:agent1",
      toolName: "translate",
      taskHash: "aaa",
      resultHash: "bbb",
      success: true,
      latencyMs: 150,
      timestamp: new Date().toISOString(),
      signature: "sig123",
    };

    it("logs and retrieves receipts", async () => {
      await store.log(receipt);
      const all = await store.getReceipts("did:key:agent1");
      expect(all).toHaveLength(1);
      expect(all[0].toolName).toBe("translate");
      expect(all[0].success).toBe(true);
    });

    it("filters by tool name", async () => {
      await store.log(receipt);
      await store.log({ ...receipt, toolName: "summarize" });
      const filtered = await store.getReceipts("did:key:agent1", "translate");
      expect(filtered).toHaveLength(1);
    });

    it("stores failure type", async () => {
      await store.log({
        ...receipt,
        success: false,
        failureType: "timeout",
      });
      const all = await store.getReceipts("did:key:agent1");
      expect(all[0].failureType).toBe("timeout");
    });

    it("returns empty for unknown agent", async () => {
      const all = await store.getReceipts("did:key:unknown");
      expect(all).toHaveLength(0);
    });
  });

  describe("co-signature columns (v0.3)", () => {
    it("stores and retrieves callerDid and callerSignature", async () => {
      await store.log({
        agentDid: "did:key:executor",
        toolName: "translate",
        taskHash: "h1",
        resultHash: "r1",
        success: true,
        latencyMs: 100,
        timestamp: new Date().toISOString(),
        signature: "execsig",
        callerDid: "did:web:caller.com",
        callerSignature: "callersig",
      });

      const receipts = await store.getReceipts("did:key:executor");
      expect(receipts).toHaveLength(1);
      expect(receipts[0].callerDid).toBe("did:web:caller.com");
      expect(receipts[0].callerSignature).toBe("callersig");
    });

    it("handles null co-signature fields", async () => {
      await store.log({
        agentDid: "did:key:executor",
        toolName: "translate",
        taskHash: "h1",
        resultHash: "r1",
        success: true,
        latencyMs: 100,
        timestamp: new Date().toISOString(),
        signature: "execsig",
      });

      const receipts = await store.getReceipts("did:key:executor");
      expect(receipts[0].callerDid).toBeNull();
      expect(receipts[0].callerSignature).toBeNull();
    });
  });

  describe("DID registry & rate limiting (v0.3)", () => {
    it("tracks DID age", async () => {
      await store.log({
        agentDid: "did:key:ratelimit",
        toolName: "test",
        taskHash: "h",
        resultHash: "r",
        success: true,
        latencyMs: 50,
        timestamp: new Date().toISOString(),
        signature: "s",
      });

      const age = await store.getDidAge("did:key:ratelimit");
      // Just created, should be very small (< 1 hour)
      expect(age).toBeLessThan(1);
      expect(age).toBeGreaterThanOrEqual(0);
    });

    it("returns 0 age for unknown DID", async () => {
      const age = await store.getDidAge("did:key:unknown");
      expect(age).toBe(0);
    });

    it("enforces receipt rate limit", async () => {
      const rateLimitedStore = new ReceiptStore(tmpDbPath(), {
        maxReceiptsPerDidPerHour: 5,
      });

      const receipt = {
        agentDid: "did:key:spammer",
        toolName: "test",
        taskHash: "h",
        resultHash: "r",
        success: true,
        latencyMs: 50,
        timestamp: new Date().toISOString(),
        signature: "s",
      };

      // First 5 should succeed
      for (let i = 0; i < 5; i++) {
        await rateLimitedStore.log({ ...receipt, taskHash: `h${i}` });
      }

      // 6th should fail
      await expect(
        rateLimitedStore.log({ ...receipt, taskHash: "h5" })
      ).rejects.toThrow("Rate limit exceeded");

      await rateLimitedStore.close();
    });
  });

  describe("getToolNames", () => {
    it("returns distinct tool names", async () => {
      const base = {
        agentDid: "did:key:agent1",
        taskHash: "h",
        resultHash: "r",
        success: true,
        latencyMs: 100,
        timestamp: new Date().toISOString(),
        signature: "sig",
      };
      await store.log({ ...base, toolName: "translate" });
      await store.log({ ...base, toolName: "translate" });
      await store.log({ ...base, toolName: "summarize" });

      const tools = await store.getToolNames("did:key:agent1");
      expect(tools.sort()).toEqual(["summarize", "translate"]);
    });
  });

  describe("persistence", () => {
    it("data survives close + reopen", async () => {
      await store.saveKeys("did:key:persist", "pub", "priv");
      await store.log({
        agentDid: "did:key:persist",
        toolName: "test",
        taskHash: "h",
        resultHash: "r",
        success: true,
        latencyMs: 50,
        timestamp: new Date().toISOString(),
        signature: "s",
      });
      await store.close();

      const store2 = new ReceiptStore(dbPath);
      const keys = await store2.getKeys("did:key:persist");
      expect(keys!.publicKey).toBe("pub");
      const receipts = await store2.getReceipts("did:key:persist");
      expect(receipts).toHaveLength(1);
      await store2.close();
    });
  });
});
