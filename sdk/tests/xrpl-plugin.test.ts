/**
 * Characterization tests for sdk/src/plugins/xrpl.ts
 *
 * Strategy: the "xrpl" npm package is NOT installed in this project.
 * Every test that would reach the require("xrpl") call therefore uses
 * jest.mock("xrpl", ...) so that Jest's module registry intercepts the
 * require before Node throws MODULE_NOT_FOUND.
 *
 * Tests that explicitly want to exercise the missing-package throw path
 * use jest.mock("xrpl") with a factory that throws, or temporarily
 * unmock and rely on the real absent module.
 *
 * All tests: no real network calls of any kind.
 */

import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { xrplPlugin, resolveXRPLDID } from "../src/plugins/xrpl";
import { ReceiptStore } from "../src/store";
import { XAIPContext, XAIP_PROTOCOL_ID } from "../src/types";

// ─── Helpers ─────────────────────────────────────────

function tmpDbPath(): string {
  return path.join(
    os.tmpdir(),
    `xaip-xrpl-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
  );
}

/** Minimal fake wallet with classicAddress. */
function fakeWallet(address = "rTestAddress123") {
  return {
    classicAddress: address,
    sign: jest.fn((tx: any) => ({ tx_blob: "FAKE_BLOB" })),
    autofill: jest.fn(),
  };
}

/** Build a minimal XAIPContext for test use. */
async function buildCtx(
  store: ReceiptStore,
  didId = "did:xrpl:rTestAddress123"
): Promise<XAIPContext> {
  return {
    did: { method: "xrpl", id: didId },
    publicKey: "fakePubKey",
    store,
  };
}

// ─── Mock xrpl client factory ────────────────────────

/**
 * Returns a jest.mock factory for the "xrpl" module.
 *
 * The Client returned by `new xrpl.Client(url)` exposes:
 *   connect()         — resolves immediately
 *   disconnect()      — resolves immediately
 *   request(cmd)      — configurable via `requestImpl`
 *   autofill(tx)      — returns tx unchanged
 *   submitAndWait()   — returns a tesSUCCESS result by default
 */
function makeXrplMock(opts: {
  requestImpl?: (cmd: any) => Promise<any>;
  submitResult?: string; // TransactionResult value, default "tesSUCCESS"
} = {}) {
  const submitResult = opts.submitResult ?? "tesSUCCESS";
  const requestImpl =
    opts.requestImpl ??
    (async () => {
      throw new Error("entryNotFound"); // no DID yet by default
    });

  const mockClient = {
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    request: jest.fn().mockImplementation(requestImpl),
    autofill: jest.fn().mockImplementation(async (tx: any) => tx),
    submitAndWait: jest.fn().mockResolvedValue({
      result: { meta: { TransactionResult: submitResult } },
    }),
  };

  const MockClient = jest.fn().mockImplementation(() => mockClient);

  return { MockClient, mockClient };
}

// ─── 1. Plugin name property ──────────────────────────

describe("xrplPlugin — static shape", () => {
  it("name property is 'xrpl'", () => {
    const plugin = xrplPlugin({});
    expect(plugin.name).toBe("xrpl");
  });

  it("returns an object with an init function", () => {
    const plugin = xrplPlugin({});
    expect(typeof plugin.init).toBe("function");
  });
});

// ─── 2. Missing-package paths ─────────────────────────

describe("xrplPlugin — missing xrpl package", () => {
  beforeEach(() => {
    // Force require("xrpl") to throw MODULE_NOT_FOUND
    jest.doMock(
      "xrpl",
      () => {
        throw new Error("Cannot find module 'xrpl'");
      },
      { virtual: true }
    );
  });

  afterEach(() => {
    jest.resetModules();
  });

  it("init throws exact error message when xrpl is not installed", async () => {
    // Re-require the plugin AFTER mock is in place so its require("xrpl") sees
    // the mock. The module is already loaded, so we call init and let the
    // dynamic require inside init throw.
    let store: ReceiptStore | undefined;
    let dbPath: string | undefined;
    try {
      dbPath = tmpDbPath();
      store = new ReceiptStore(dbPath);
      const ctx = await buildCtx(store);
      const plugin = xrplPlugin({ wallet: fakeWallet() });
      await expect(plugin.init(ctx)).rejects.toThrow(
        "xrpl package not installed. Run: npm install xrpl"
      );
    } finally {
      await store?.close();
      if (dbPath && fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    }
  });
});

describe("resolveXRPLDID — missing xrpl package", () => {
  beforeEach(() => {
    jest.doMock(
      "xrpl",
      () => {
        throw new Error("Cannot find module 'xrpl'");
      },
      { virtual: true }
    );
  });

  afterEach(() => {
    jest.resetModules();
  });

  it("throws exact error message when xrpl is not installed", async () => {
    await expect(resolveXRPLDID("rSomeAddress")).rejects.toThrow(
      "xrpl package not installed. Run: npm install xrpl"
    );
  });
});

// ─── 3. Network URL selection ─────────────────────────

describe("xrplPlugin — network URL selection", () => {
  afterEach(() => {
    jest.resetModules();
  });

  it("uses testnet URL by default", async () => {
    const { MockClient, mockClient } = makeXrplMock();
    jest.doMock("xrpl", () => ({ Client: MockClient }), { virtual: true });

    const dbPath = tmpDbPath();
    const store = new ReceiptStore(dbPath);
    try {
      const ctx = await buildCtx(store);
      const plugin = xrplPlugin({}); // no network, no wallet
      await plugin.init(ctx);
      expect(MockClient).toHaveBeenCalledWith(
        "wss://s.altnet.rippletest.net:51233"
      );
    } finally {
      await store.close();
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    }
  });

  it("uses mainnet URL when network: 'mainnet'", async () => {
    const { MockClient } = makeXrplMock();
    jest.doMock("xrpl", () => ({ Client: MockClient }), { virtual: true });

    const dbPath = tmpDbPath();
    const store = new ReceiptStore(dbPath);
    try {
      const ctx = await buildCtx(store);
      const plugin = xrplPlugin({ network: "mainnet" });
      await plugin.init(ctx);
      expect(MockClient).toHaveBeenCalledWith("wss://xrplcluster.com");
    } finally {
      await store.close();
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    }
  });

  it("uses devnet URL when network: 'devnet'", async () => {
    const { MockClient } = makeXrplMock();
    jest.doMock("xrpl", () => ({ Client: MockClient }), { virtual: true });

    const dbPath = tmpDbPath();
    const store = new ReceiptStore(dbPath);
    try {
      const ctx = await buildCtx(store);
      const plugin = xrplPlugin({ network: "devnet" });
      await plugin.init(ctx);
      expect(MockClient).toHaveBeenCalledWith(
        "wss://s.devnet.rippletest.net:51233"
      );
    } finally {
      await store.close();
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    }
  });
});

// ─── 4. connect / disconnect lifecycle ───────────────

describe("xrplPlugin — connect/disconnect lifecycle", () => {
  afterEach(() => {
    jest.resetModules();
  });

  it("always calls connect then disconnect even when no wallet is provided", async () => {
    const { MockClient, mockClient } = makeXrplMock();
    jest.doMock("xrpl", () => ({ Client: MockClient }), { virtual: true });

    const dbPath = tmpDbPath();
    const store = new ReceiptStore(dbPath);
    try {
      const ctx = await buildCtx(store);
      const plugin = xrplPlugin({}); // no wallet
      await plugin.init(ctx);
      expect(mockClient.connect).toHaveBeenCalledTimes(1);
      expect(mockClient.disconnect).toHaveBeenCalledTimes(1);
    } finally {
      await store.close();
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    }
  });

  it("calls disconnect in finally even when submitAndWait rejects", async () => {
    const { MockClient, mockClient } = makeXrplMock({
      // no existing DID (request throws), autofill ok, submit throws
    });
    mockClient.submitAndWait.mockRejectedValue(new Error("network error"));

    jest.doMock("xrpl", () => ({ Client: MockClient }), { virtual: true });

    const dbPath = tmpDbPath();
    const store = new ReceiptStore(dbPath);
    try {
      const ctx = await buildCtx(store);
      const plugin = xrplPlugin({ wallet: fakeWallet() });
      await expect(plugin.init(ctx)).rejects.toThrow("network error");
      // disconnect must still have been called
      expect(mockClient.disconnect).toHaveBeenCalledTimes(1);
    } finally {
      await store.close();
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    }
  });
});

// ─── 5. DID registration branch ──────────────────────

describe("xrplPlugin — DID registration", () => {
  afterEach(() => {
    jest.resetModules();
  });

  it("submits DIDSet when DID does not yet exist (request throws)", async () => {
    const { MockClient, mockClient } = makeXrplMock({
      requestImpl: async () => {
        throw new Error("entryNotFound");
      },
    });
    jest.doMock("xrpl", () => ({ Client: MockClient }), { virtual: true });

    const dbPath = tmpDbPath();
    const store = new ReceiptStore(dbPath);
    try {
      const wallet = fakeWallet("rNew123");
      const ctx = await buildCtx(store, "did:xrpl:rNew123");
      const plugin = xrplPlugin({ wallet });
      await plugin.init(ctx);

      expect(mockClient.submitAndWait).toHaveBeenCalledTimes(1);
      const [txBlob] = mockClient.submitAndWait.mock.calls[0];
      expect(txBlob).toBe("FAKE_BLOB"); // wallet.sign returned { tx_blob: "FAKE_BLOB" }
    } finally {
      await store.close();
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    }
  });

  it("does NOT submit DIDSet when DID already exists (node present in response)", async () => {
    const { MockClient, mockClient } = makeXrplMock({
      requestImpl: async () => ({
        result: { node: { LedgerEntryType: "DID" } },
      }),
    });
    jest.doMock("xrpl", () => ({ Client: MockClient }), { virtual: true });

    const dbPath = tmpDbPath();
    const store = new ReceiptStore(dbPath);
    try {
      const wallet = fakeWallet("rExisting456");
      const ctx = await buildCtx(store, "did:xrpl:rExisting456");
      const plugin = xrplPlugin({ wallet });
      await plugin.init(ctx);

      expect(mockClient.submitAndWait).not.toHaveBeenCalled();
    } finally {
      await store.close();
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    }
  });

  it("uses classicAddress from wallet for DIDSet Account field", async () => {
    const { MockClient, mockClient } = makeXrplMock({
      requestImpl: async () => {
        throw new Error("entryNotFound");
      },
    });
    jest.doMock("xrpl", () => ({ Client: MockClient }), { virtual: true });

    const dbPath = tmpDbPath();
    const store = new ReceiptStore(dbPath);
    try {
      const wallet = fakeWallet("rClassicAddr789");
      const ctx = await buildCtx(store, "did:xrpl:rClassicAddr789");
      const plugin = xrplPlugin({ wallet });
      await plugin.init(ctx);

      const signCall = wallet.sign.mock.calls[0][0];
      expect(signCall.Account).toBe("rClassicAddr789");
      expect(signCall.TransactionType).toBe("DIDSet");
    } finally {
      await store.close();
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    }
  });

  it("falls back to wallet.address when classicAddress is absent", async () => {
    const { MockClient, mockClient } = makeXrplMock({
      requestImpl: async () => {
        throw new Error("entryNotFound");
      },
    });
    jest.doMock("xrpl", () => ({ Client: MockClient }), { virtual: true });

    const dbPath = tmpDbPath();
    const store = new ReceiptStore(dbPath);
    try {
      // wallet without classicAddress
      const wallet = {
        address: "rAddressField999",
        sign: jest.fn((tx: any) => ({ tx_blob: "FAKE_BLOB" })),
      };
      const ctx = await buildCtx(store, "did:xrpl:rAddressField999");
      const plugin = xrplPlugin({ wallet });
      await plugin.init(ctx);

      const signCall = wallet.sign.mock.calls[0][0];
      expect(signCall.Account).toBe("rAddressField999");
    } finally {
      await store.close();
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    }
  });

  it("DIDSet Data field is hex of XAIP_PROTOCOL_ID", async () => {
    const { MockClient, mockClient } = makeXrplMock({
      requestImpl: async () => {
        throw new Error("entryNotFound");
      },
    });
    jest.doMock("xrpl", () => ({ Client: MockClient }), { virtual: true });

    const dbPath = tmpDbPath();
    const store = new ReceiptStore(dbPath);
    try {
      const wallet = fakeWallet();
      const ctx = await buildCtx(store);
      const plugin = xrplPlugin({ wallet });
      await plugin.init(ctx);

      const signCall = wallet.sign.mock.calls[0][0];
      const expectedDataHex = Buffer.from(XAIP_PROTOCOL_ID, "utf-8")
        .toString("hex")
        .toUpperCase();
      expect(signCall.Data).toBe(expectedDataHex);
    } finally {
      await store.close();
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    }
  });

  it("DIDSet URI field is hex of 'xaip:<ctx.did.id>'", async () => {
    const { MockClient } = makeXrplMock({
      requestImpl: async () => {
        throw new Error("entryNotFound");
      },
    });
    jest.doMock("xrpl", () => ({ Client: MockClient }), { virtual: true });

    const dbPath = tmpDbPath();
    const store = new ReceiptStore(dbPath);
    try {
      const wallet = fakeWallet("rUriTest");
      const ctx = await buildCtx(store, "did:xrpl:rUriTest");
      const plugin = xrplPlugin({ wallet });
      await plugin.init(ctx);

      const signCall = wallet.sign.mock.calls[0][0];
      const expectedUriHex = Buffer.from("xaip:did:xrpl:rUriTest", "utf-8")
        .toString("hex")
        .toUpperCase();
      expect(signCall.URI).toBe(expectedUriHex);
    } finally {
      await store.close();
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    }
  });

  it("does not submit DIDSet when wallet is absent", async () => {
    const { MockClient, mockClient } = makeXrplMock();
    jest.doMock("xrpl", () => ({ Client: MockClient }), { virtual: true });

    const dbPath = tmpDbPath();
    const store = new ReceiptStore(dbPath);
    try {
      const ctx = await buildCtx(store);
      const plugin = xrplPlugin({}); // no wallet
      await plugin.init(ctx);
      expect(mockClient.submitAndWait).not.toHaveBeenCalled();
    } finally {
      await store.close();
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    }
  });
});

// ─── 6. Score anchoring branch ───────────────────────

describe("xrplPlugin — score anchoring", () => {
  afterEach(() => {
    jest.resetModules();
  });

  it("does NOT submit anchor Payment when anchorScores is false (default)", async () => {
    const { MockClient, mockClient } = makeXrplMock({
      requestImpl: async () => {
        throw new Error("entryNotFound");
      },
    });
    jest.doMock("xrpl", () => ({ Client: MockClient }), { virtual: true });

    const dbPath = tmpDbPath();
    const store = new ReceiptStore(dbPath);
    try {
      const wallet = fakeWallet();
      const ctx = await buildCtx(store);
      const plugin = xrplPlugin({ wallet }); // anchorScores not set
      await plugin.init(ctx);

      // Only the DIDSet call — no anchor Payment
      expect(mockClient.submitAndWait).toHaveBeenCalledTimes(1);
    } finally {
      await store.close();
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    }
  });

  it("submits anchor Payment when anchorScores: true", async () => {
    // Make DID already exist so only 1 submitAndWait (the anchor)
    const { MockClient, mockClient } = makeXrplMock({
      requestImpl: async () => ({
        result: { node: { LedgerEntryType: "DID" } },
      }),
    });
    jest.doMock("xrpl", () => ({ Client: MockClient }), { virtual: true });

    const dbPath = tmpDbPath();
    const store = new ReceiptStore(dbPath);
    try {
      // Add some receipts so computeQueryResult has data
      const receipt = {
        agentDid: "did:xrpl:rAnchorTest",
        toolName: "test-tool",
        taskHash: "h1",
        resultHash: "r1",
        success: true,
        latencyMs: 100,
        timestamp: new Date().toISOString(),
        signature: "sig1",
      };
      // Log enough receipts to pass MIN_EXECUTIONS (5)
      for (let i = 0; i < 6; i++) {
        await store.log({ ...receipt, taskHash: `h${i}`, resultHash: `r${i}` });
      }

      const wallet = fakeWallet("rAnchorTest");
      const ctx = await buildCtx(store, "did:xrpl:rAnchorTest");
      const plugin = xrplPlugin({ wallet, anchorScores: true });
      await plugin.init(ctx);

      // Should have submitted the anchor Payment
      expect(mockClient.submitAndWait).toHaveBeenCalledTimes(1);
      // The sign call should have produced tx_blob for a Payment
      const signCall = wallet.sign.mock.calls[0][0];
      expect(signCall.TransactionType).toBe("Payment");
      expect(signCall.Amount).toBe("1"); // 1 drop
      expect(signCall.Destination).toBe("rAnchorTest"); // self-payment // pins current behavior
    } finally {
      await store.close();
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    }
  });

  it("Payment Memo contains hex-encoded XAIP/ScoreAnchor MemoType", async () => {
    const { MockClient } = makeXrplMock({
      requestImpl: async () => ({
        result: { node: { LedgerEntryType: "DID" } },
      }),
    });
    jest.doMock("xrpl", () => ({ Client: MockClient }), { virtual: true });

    const dbPath = tmpDbPath();
    const store = new ReceiptStore(dbPath);
    try {
      const receipt = {
        agentDid: "did:xrpl:rMemoTest",
        toolName: "t",
        taskHash: "h",
        resultHash: "r",
        success: true,
        latencyMs: 50,
        timestamp: new Date().toISOString(),
        signature: "s",
      };
      for (let i = 0; i < 6; i++) {
        await store.log({ ...receipt, taskHash: `h${i}`, resultHash: `r${i}` });
      }

      const wallet = fakeWallet("rMemoTest");
      const ctx = await buildCtx(store, "did:xrpl:rMemoTest");
      const plugin = xrplPlugin({ wallet, anchorScores: true });
      await plugin.init(ctx);

      const signCall = wallet.sign.mock.calls[0][0];
      const memoType = signCall.Memos[0].Memo.MemoType;
      const expectedMemoTypeHex = Buffer.from("XAIP/ScoreAnchor", "utf-8")
        .toString("hex")
        .toUpperCase();
      expect(memoType).toBe(expectedMemoTypeHex);
    } finally {
      await store.close();
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    }
  });

  it("Payment Memo MemoData is hex-encoded JSON with did, scoreHash, overall, trust, timestamp", async () => {
    const { MockClient } = makeXrplMock({
      requestImpl: async () => ({
        result: { node: { LedgerEntryType: "DID" } },
      }),
    });
    jest.doMock("xrpl", () => ({ Client: MockClient }), { virtual: true });

    const dbPath = tmpDbPath();
    const store = new ReceiptStore(dbPath);
    try {
      const receipt = {
        agentDid: "did:xrpl:rMemoDataTest",
        toolName: "t",
        taskHash: "h",
        resultHash: "r",
        success: true,
        latencyMs: 50,
        timestamp: new Date().toISOString(),
        signature: "s",
      };
      for (let i = 0; i < 6; i++) {
        await store.log({ ...receipt, taskHash: `h${i}`, resultHash: `r${i}` });
      }

      const wallet = fakeWallet("rMemoDataTest");
      const ctx = await buildCtx(store, "did:xrpl:rMemoDataTest");
      const plugin = xrplPlugin({ wallet, anchorScores: true });
      await plugin.init(ctx);

      const signCall = wallet.sign.mock.calls[0][0];
      const memoDataHex = signCall.Memos[0].Memo.MemoData;
      // MemoData is uppercase hex of JSON
      const memoJson = JSON.parse(
        Buffer.from(memoDataHex, "hex").toString("utf-8")
      );
      expect(memoJson).toHaveProperty("did", "did:xrpl:rMemoDataTest");
      expect(memoJson).toHaveProperty("scoreHash");
      expect(typeof memoJson.scoreHash).toBe("string");
      expect(memoJson).toHaveProperty("overall");
      expect(typeof memoJson.overall).toBe("number");
      expect(memoJson).toHaveProperty("trust");
      expect(memoJson).toHaveProperty("timestamp");
    } finally {
      await store.close();
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    }
  });

  it("anchorScores branch is skipped when wallet is absent (no crash)", async () => {
    const { MockClient, mockClient } = makeXrplMock();
    jest.doMock("xrpl", () => ({ Client: MockClient }), { virtual: true });

    const dbPath = tmpDbPath();
    const store = new ReceiptStore(dbPath);
    try {
      const ctx = await buildCtx(store);
      // anchorScores: true but no wallet — outer if(config.wallet) guards
      const plugin = xrplPlugin({ anchorScores: true });
      await expect(plugin.init(ctx)).resolves.toBeUndefined();
      expect(mockClient.submitAndWait).not.toHaveBeenCalled();
    } finally {
      await store.close();
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    }
  });
});

// ─── 7. resolveXRPLDID ────────────────────────────────

describe("resolveXRPLDID", () => {
  afterEach(() => {
    jest.resetModules();
  });

  it("returns null when ledger_entry throws (entry not found)", async () => {
    const { MockClient } = makeXrplMock({
      requestImpl: async () => {
        throw new Error("entryNotFound");
      },
    });
    jest.doMock("xrpl", () => ({ Client: MockClient }), { virtual: true });

    const result = await resolveXRPLDID("rNotFound");
    expect(result).toBeNull();
  });

  it("returns null when result.node is absent", async () => {
    const { MockClient } = makeXrplMock({
      requestImpl: async () => ({ result: {} }), // no node key
    });
    jest.doMock("xrpl", () => ({ Client: MockClient }), { virtual: true });

    const result = await resolveXRPLDID("rNoNode");
    expect(result).toBeNull();
  });

  it("returns did:xrpl:<address> when node is present", async () => {
    const { MockClient } = makeXrplMock({
      requestImpl: async () => ({
        result: {
          node: {
            LedgerEntryType: "DID",
            URI: Buffer.from("xaip:did:xrpl:rFound", "utf-8")
              .toString("hex")
              .toUpperCase(),
            Data: Buffer.from("XAIP/0.4.0", "utf-8")
              .toString("hex")
              .toUpperCase(),
          },
        },
      }),
    });
    jest.doMock("xrpl", () => ({ Client: MockClient }), { virtual: true });

    const result = await resolveXRPLDID("rFound");
    expect(result).not.toBeNull();
    expect(result!.did).toBe("did:xrpl:rFound");
  });

  it("decodes URI hex field back to UTF-8 string", async () => {
    const originalUri = "xaip:did:xrpl:rDecodeTest";
    const uriHex = Buffer.from(originalUri, "utf-8")
      .toString("hex")
      .toUpperCase();

    const { MockClient } = makeXrplMock({
      requestImpl: async () => ({
        result: {
          node: { LedgerEntryType: "DID", URI: uriHex, Data: "" },
        },
      }),
    });
    jest.doMock("xrpl", () => ({ Client: MockClient }), { virtual: true });

    const result = await resolveXRPLDID("rDecodeTest");
    expect(result!.uri).toBe(originalUri);
  });

  it("decodes Data hex field back to UTF-8 string", async () => {
    const originalData = XAIP_PROTOCOL_ID;
    const dataHex = Buffer.from(originalData, "utf-8")
      .toString("hex")
      .toUpperCase();

    const { MockClient } = makeXrplMock({
      requestImpl: async () => ({
        result: {
          node: { LedgerEntryType: "DID", URI: "", Data: dataHex },
        },
      }),
    });
    jest.doMock("xrpl", () => ({ Client: MockClient }), { virtual: true });

    const result = await resolveXRPLDID("rDataTest");
    expect(result!.data).toBe(originalData);
  });

  it("returns empty string for uri when node.URI is absent", async () => {
    const { MockClient } = makeXrplMock({
      requestImpl: async () => ({
        result: {
          node: { LedgerEntryType: "DID" }, // no URI field
        },
      }),
    });
    jest.doMock("xrpl", () => ({ Client: MockClient }), { virtual: true });

    const result = await resolveXRPLDID("rNoURI");
    expect(result!.uri).toBe("");
  });

  it("returns empty string for data when node.Data is absent", async () => {
    const { MockClient } = makeXrplMock({
      requestImpl: async () => ({
        result: {
          node: { LedgerEntryType: "DID" }, // no Data field
        },
      }),
    });
    jest.doMock("xrpl", () => ({ Client: MockClient }), { virtual: true });

    const result = await resolveXRPLDID("rNoData");
    expect(result!.data).toBe("");
  });

  it("uses testnet URL by default", async () => {
    const { MockClient } = makeXrplMock({
      requestImpl: async () => ({ result: {} }),
    });
    jest.doMock("xrpl", () => ({ Client: MockClient }), { virtual: true });

    await resolveXRPLDID("rAddr");
    expect(MockClient).toHaveBeenCalledWith(
      "wss://s.altnet.rippletest.net:51233"
    );
  });

  it("uses mainnet URL when network param is 'mainnet'", async () => {
    const { MockClient } = makeXrplMock({
      requestImpl: async () => ({ result: {} }),
    });
    jest.doMock("xrpl", () => ({ Client: MockClient }), { virtual: true });

    await resolveXRPLDID("rAddr", "mainnet");
    expect(MockClient).toHaveBeenCalledWith("wss://xrplcluster.com");
  });

  it("always calls connect then disconnect", async () => {
    const { MockClient, mockClient } = makeXrplMock({
      requestImpl: async () => ({ result: {} }),
    });
    jest.doMock("xrpl", () => ({ Client: MockClient }), { virtual: true });

    await resolveXRPLDID("rAddr");
    expect(mockClient.connect).toHaveBeenCalledTimes(1);
    expect(mockClient.disconnect).toHaveBeenCalledTimes(1);
  });

  it("calls disconnect in finally even when request throws", async () => {
    const { MockClient, mockClient } = makeXrplMock({
      requestImpl: async () => {
        throw new Error("network error");
      },
    });
    jest.doMock("xrpl", () => ({ Client: MockClient }), { virtual: true });

    // catch swallows to null
    const result = await resolveXRPLDID("rErrAddr");
    expect(result).toBeNull();
    expect(mockClient.disconnect).toHaveBeenCalledTimes(1);
  });

  it("passes address to ledger_entry command", async () => {
    const { MockClient, mockClient } = makeXrplMock({
      requestImpl: async () => ({ result: {} }),
    });
    jest.doMock("xrpl", () => ({ Client: MockClient }), { virtual: true });

    await resolveXRPLDID("rSpecificAddr");
    expect(mockClient.request).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "ledger_entry",
        did: "rSpecificAddr",
      })
    );
  });
});

// ─── 8. stringToHex / hexToString — indirect coverage ─

describe("stringToHex / hexToString — tested indirectly through public flows", () => {
  afterEach(() => {
    jest.resetModules();
  });

  it("round-trips ASCII strings via DIDSet Data and resolveXRPLDID Data decode", async () => {
    // Write "hello world" into Data, read it back via resolveXRPLDID
    const encoded = Buffer.from("hello world", "utf-8")
      .toString("hex")
      .toUpperCase();

    const { MockClient } = makeXrplMock({
      requestImpl: async () => ({
        result: { node: { LedgerEntryType: "DID", Data: encoded, URI: "" } },
      }),
    });
    jest.doMock("xrpl", () => ({ Client: MockClient }), { virtual: true });

    const result = await resolveXRPLDID("rRoundTrip");
    expect(result!.data).toBe("hello world");
  });

  it("round-trips UTF-8 multibyte strings via URI field", async () => {
    const original = "xaip:こんにちは"; // Japanese "konnichiwa"
    const encoded = Buffer.from(original, "utf-8")
      .toString("hex")
      .toUpperCase();

    const { MockClient } = makeXrplMock({
      requestImpl: async () => ({
        result: { node: { LedgerEntryType: "DID", URI: encoded, Data: "" } },
      }),
    });
    jest.doMock("xrpl", () => ({ Client: MockClient }), { virtual: true });

    const result = await resolveXRPLDID("rUtf8Test");
    expect(result!.uri).toBe(original);
  });
});
