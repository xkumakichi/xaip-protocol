/**
 * Characterization tests for sdk/src/otel.ts
 *
 * OTel packages ARE installed as dependencies, so we test the full path
 * (span attribute mapping, timestamp back-calculation, span status, etc.)
 * AND the graceful-degradation path (import failure → no-throw).
 *
 * We mock @opentelemetry/exporter-trace-otlp-http so that no real network
 * calls are made, substituting an InMemorySpanExporter for attribute capture.
 * We do NOT modify any production code.
 */

import { SpanStatusCode, trace } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";

// ─── In-memory exporter shared across tests in the full-path suite ──────────

let memExporter: InMemorySpanExporter;

/**
 * We replace the real OTLPTraceExporter with an InMemorySpanExporter so that
 * XAIPOtelExporter.init() uses our in-memory collector.  Jest hoists
 * jest.mock() calls, so this factory runs before any import of otel.ts.
 */
jest.mock("@opentelemetry/exporter-trace-otlp-http", () => {
  // The exporter module needs to be loaded fresh inside the factory.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { InMemorySpanExporter: Mem } = require("@opentelemetry/sdk-trace-base");
  const shared: InMemorySpanExporter = new Mem();
  // Expose it so tests can access it via the module-level `memExporter` var.
  // We re-assign after mock setup in beforeAll.
  (global as any).__xaipTestMemExporter__ = shared;
  return {
    OTLPTraceExporter: class MockOTLPTraceExporter extends Mem {
      constructor(_opts?: unknown) {
        super();
        // Replace instance with the shared one by copying the reference trick.
        // Since InMemorySpanExporter is a class with mutable state we just
        // point the global at this instance.
        (global as any).__xaipTestMemExporter__ = this;
      }
    },
  };
});

// After jest.mock runs and modules are loaded we retrieve the shared exporter.
import { XAIPOtelExporter, otelPlugin } from "../src/otel";
import type { ExecutionReceipt, XAIPContext } from "../src/types";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeReceipt(overrides: Partial<ExecutionReceipt> = {}): ExecutionReceipt {
  return {
    agentDid: "did:key:agent123",
    toolName: "translate",
    taskHash: "task-hash-abc",
    resultHash: "result-hash-def",
    success: true,
    latencyMs: 200,
    timestamp: "2026-04-24T00:00:00.000Z",
    signature: "sig-executor",
    ...overrides,
  };
}

/** Return the InMemorySpanExporter instance created by the mock constructor. */
function getSharedExporter(): InMemorySpanExporter {
  return (global as any).__xaipTestMemExporter__ as InMemorySpanExporter;
}

/**
 * OTel allows only ONE global tracer provider per process; a second
 * provider.register() is silently rejected, so spans from later exporter
 * instances would be routed to the first (possibly shut-down) provider.
 * Clearing the global before each test lets every init() register fresh.
 */
beforeEach(() => {
  trace.disable();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Silence console.error output during tests that intentionally trigger
 * the [xaip:otel] error messages, keeping test output clean.
 */
function suppressConsoleError(): jest.SpyInstance {
  return jest.spyOn(console, "error").mockImplementation(() => {});
}

// ─── Suite 1: Constructor defaults ───────────────────────────────────────────

describe("XAIPOtelExporter — constructor defaults", () => {
  it("uses 'xaip-agent' as default service name and localhost endpoint", async () => {
    const spy = suppressConsoleError();
    const exp = new XAIPOtelExporter();
    // Access private fields via cast — pins current field names
    expect((exp as any).serviceName).toBe("xaip-agent");
    expect((exp as any).endpoint).toBe("http://localhost:4318/v1/traces");
    await exp.shutdown();
    spy.mockRestore();
  });

  it("accepts custom serviceName and endpoint", async () => {
    const spy = suppressConsoleError();
    const exp = new XAIPOtelExporter({
      serviceName: "my-service",
      endpoint: "http://collector:4318/v1/traces",
    });
    expect((exp as any).serviceName).toBe("my-service");
    expect((exp as any).endpoint).toBe("http://collector:4318/v1/traces");
    await exp.shutdown();
    spy.mockRestore();
  });
});

// ─── Suite 2: init() ─────────────────────────────────────────────────────────

describe("XAIPOtelExporter — init()", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("does not throw on init()", async () => {
    const spy = suppressConsoleError();
    const exp = new XAIPOtelExporter({ serviceName: "test-init" });
    await expect(exp.init()).resolves.toBeUndefined();
    await exp.shutdown();
    spy.mockRestore();
  });

  it("sets ready=true after successful init()", async () => {
    const spy = suppressConsoleError();
    const exp = new XAIPOtelExporter({ serviceName: "test-ready" });
    expect((exp as any).ready).toBe(false);
    await exp.init();
    expect((exp as any).ready).toBe(true);
    await exp.shutdown();
    spy.mockRestore();
  });

  it("init() is idempotent — second call is a no-op (does not re-initialize)", async () => {
    const spy = suppressConsoleError();
    const exp = new XAIPOtelExporter({ serviceName: "test-idempotent" });
    await exp.init();
    const tracerAfterFirst = (exp as any).tracer;
    await exp.init(); // second call
    // pins current behavior: tracer reference unchanged
    expect((exp as any).tracer).toBe(tracerAfterFirst);
    await exp.shutdown();
    spy.mockRestore();
  });

  it("emits console.error with service name and endpoint on successful init", async () => {
    const spy = suppressConsoleError();
    const exp = new XAIPOtelExporter({
      serviceName: "my-svc",
      endpoint: "http://custom:4318/v1/traces",
    });
    await exp.init();
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('service="my-svc"')
    );
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('endpoint="http://custom:4318/v1/traces"')
    );
    await exp.shutdown();
    spy.mockRestore();
  });
});

// ─── Suite 3: exportReceipt() before init — no-op path ───────────────────────

describe("XAIPOtelExporter — exportReceipt() before init()", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("does not throw when called before init()", () => {
    const spy = suppressConsoleError();
    const exp = new XAIPOtelExporter();
    const receipt = makeReceipt();
    // pins current behavior: returns undefined without throwing
    expect(() => exp.exportReceipt(receipt)).not.toThrow();
    spy.mockRestore();
  });

  it("emits console.error 'Not initialized' when called before init()", () => {
    const spy = suppressConsoleError();
    const exp = new XAIPOtelExporter();
    exp.exportReceipt(makeReceipt());
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("Not initialized")
    );
    spy.mockRestore();
  });

  it("returns undefined (void) when called before init()", () => {
    const spy = suppressConsoleError();
    const exp = new XAIPOtelExporter();
    const result = exp.exportReceipt(makeReceipt());
    expect(result).toBeUndefined();
    spy.mockRestore();
  });
});

// ─── Suite 4: exportReceipt() span attribute mapping ─────────────────────────

describe("XAIPOtelExporter — exportReceipt() span attribute mapping", () => {
  let exp: XAIPOtelExporter;

  beforeEach(async () => {
    const consoleSpy = suppressConsoleError();
    exp = new XAIPOtelExporter({ serviceName: "attr-test" });
    await exp.init();
    // Flush the shared exporter before each test
    getSharedExporter().reset();
    consoleSpy.mockRestore();
    jest.restoreAllMocks();
  });

  afterEach(async () => {
    const consoleSpy = suppressConsoleError();
    await exp.shutdown();
    consoleSpy.mockRestore();
  });

  function getSpan(): ReadableSpan {
    const spans = getSharedExporter().getFinishedSpans();
    expect(spans).toHaveLength(1);
    return spans[0];
  }

  it("span name is 'xaip.tool.<toolName>'", () => {
    const consoleSpy = suppressConsoleError();
    exp.exportReceipt(makeReceipt({ toolName: "my-tool" }));
    expect(getSpan().name).toBe("xaip.tool.my-tool");
    consoleSpy.mockRestore();
  });

  it("sets xaip.agent.did attribute from receipt.agentDid", () => {
    const consoleSpy = suppressConsoleError();
    exp.exportReceipt(makeReceipt({ agentDid: "did:key:agentABC" }));
    expect(getSpan().attributes["xaip.agent.did"]).toBe("did:key:agentABC");
    consoleSpy.mockRestore();
  });

  it("sets xaip.tool.name attribute from receipt.toolName", () => {
    const consoleSpy = suppressConsoleError();
    exp.exportReceipt(makeReceipt({ toolName: "code-gen" }));
    expect(getSpan().attributes["xaip.tool.name"]).toBe("code-gen");
    consoleSpy.mockRestore();
  });

  it("sets xaip.task.hash from receipt.taskHash", () => {
    const consoleSpy = suppressConsoleError();
    exp.exportReceipt(makeReceipt({ taskHash: "task-xyz" }));
    expect(getSpan().attributes["xaip.task.hash"]).toBe("task-xyz");
    consoleSpy.mockRestore();
  });

  it("sets xaip.result.hash from receipt.resultHash", () => {
    const consoleSpy = suppressConsoleError();
    exp.exportReceipt(makeReceipt({ resultHash: "result-xyz" }));
    expect(getSpan().attributes["xaip.result.hash"]).toBe("result-xyz");
    consoleSpy.mockRestore();
  });

  it("sets xaip.success to true on a successful receipt", () => {
    const consoleSpy = suppressConsoleError();
    exp.exportReceipt(makeReceipt({ success: true }));
    expect(getSpan().attributes["xaip.success"]).toBe(true);
    consoleSpy.mockRestore();
  });

  it("sets xaip.success to false on a failed receipt", () => {
    const consoleSpy = suppressConsoleError();
    exp.exportReceipt(makeReceipt({ success: false, failureType: "error" }));
    expect(getSpan().attributes["xaip.success"]).toBe(false);
    consoleSpy.mockRestore();
  });

  it("sets xaip.latency_ms from receipt.latencyMs", () => {
    const consoleSpy = suppressConsoleError();
    exp.exportReceipt(makeReceipt({ latencyMs: 350 }));
    expect(getSpan().attributes["xaip.latency_ms"]).toBe(350);
    consoleSpy.mockRestore();
  });

  it("xaip.cosigned is false when callerSignature is undefined", () => {
    const consoleSpy = suppressConsoleError();
    const receipt = makeReceipt({ callerSignature: undefined });
    exp.exportReceipt(receipt);
    expect(getSpan().attributes["xaip.cosigned"]).toBe(false);
    consoleSpy.mockRestore();
  });

  it("xaip.cosigned is false when callerSignature is null", () => {
    const consoleSpy = suppressConsoleError();
    // pins current behavior: null callerSignature → cosigned=false
    const receipt = makeReceipt({
      callerSignature: null as unknown as string,
    });
    exp.exportReceipt(receipt);
    expect(getSpan().attributes["xaip.cosigned"]).toBe(false);
    consoleSpy.mockRestore();
  });

  it("xaip.cosigned is true when callerSignature is a non-empty string", () => {
    const consoleSpy = suppressConsoleError();
    exp.exportReceipt(
      makeReceipt({
        callerDid: "did:key:caller",
        callerSignature: "sig-caller-abc",
      })
    );
    expect(getSpan().attributes["xaip.cosigned"]).toBe(true);
    consoleSpy.mockRestore();
  });

  it("xaip.caller.did is set when callerDid is provided", () => {
    const consoleSpy = suppressConsoleError();
    exp.exportReceipt(
      makeReceipt({ callerDid: "did:web:caller.example.com" })
    );
    expect(getSpan().attributes["xaip.caller.did"]).toBe(
      "did:web:caller.example.com"
    );
    consoleSpy.mockRestore();
  });

  it("xaip.caller.did is NOT set when callerDid is absent", () => {
    const consoleSpy = suppressConsoleError();
    const receipt = makeReceipt({ callerDid: undefined });
    exp.exportReceipt(receipt);
    expect(getSpan().attributes).not.toHaveProperty("xaip.caller.did");
    consoleSpy.mockRestore();
  });

  it("xaip.failure_type is set when failureType is provided", () => {
    const consoleSpy = suppressConsoleError();
    exp.exportReceipt(
      makeReceipt({ success: false, failureType: "timeout" })
    );
    expect(getSpan().attributes["xaip.failure_type"]).toBe("timeout");
    consoleSpy.mockRestore();
  });

  it("xaip.failure_type is NOT set when failureType is absent", () => {
    const consoleSpy = suppressConsoleError();
    const receipt = makeReceipt({ failureType: undefined });
    exp.exportReceipt(receipt);
    expect(getSpan().attributes).not.toHaveProperty("xaip.failure_type");
    consoleSpy.mockRestore();
  });

  it("xaip.failure_type IS set when failureType is empty string — pins current behavior", () => {
    const consoleSpy = suppressConsoleError();
    // pins current behavior: the guard is `!== undefined && !== null`, so ""
    // passes through and gets setAttribute called with "" value
    const receipt = makeReceipt({
      failureType: "" as unknown as ExecutionReceipt["failureType"],
    });
    exp.exportReceipt(receipt);
    // Empty string passes the !== undefined && !== null guard
    expect(getSpan().attributes["xaip.failure_type"]).toBe("");
    consoleSpy.mockRestore();
  });
});

// ─── Suite 5: span status mapping ────────────────────────────────────────────

describe("XAIPOtelExporter — span status", () => {
  let exp: XAIPOtelExporter;

  beforeEach(async () => {
    const consoleSpy = suppressConsoleError();
    exp = new XAIPOtelExporter({ serviceName: "status-test" });
    await exp.init();
    getSharedExporter().reset();
    consoleSpy.mockRestore();
    jest.restoreAllMocks();
  });

  afterEach(async () => {
    const consoleSpy = suppressConsoleError();
    await exp.shutdown();
    consoleSpy.mockRestore();
  });

  it("span status is OK on success=true", () => {
    const consoleSpy = suppressConsoleError();
    exp.exportReceipt(makeReceipt({ success: true }));
    const spans = getSharedExporter().getFinishedSpans();
    expect(spans[0].status.code).toBe(SpanStatusCode.OK);
    consoleSpy.mockRestore();
  });

  it("span status is ERROR on success=false", () => {
    const consoleSpy = suppressConsoleError();
    exp.exportReceipt(makeReceipt({ success: false, failureType: "error" }));
    const spans = getSharedExporter().getFinishedSpans();
    expect(spans[0].status.code).toBe(SpanStatusCode.ERROR);
    consoleSpy.mockRestore();
  });

  it("span status message is failureType on failure", () => {
    const consoleSpy = suppressConsoleError();
    exp.exportReceipt(
      makeReceipt({ success: false, failureType: "validation" })
    );
    const spans = getSharedExporter().getFinishedSpans();
    expect(spans[0].status.message).toBe("validation");
    consoleSpy.mockRestore();
  });

  it("span status message is 'execution failed' when failureType is absent on failure — pins current behavior", () => {
    const consoleSpy = suppressConsoleError();
    // pins current behavior: failureType ?? "execution failed"
    exp.exportReceipt(makeReceipt({ success: false, failureType: undefined }));
    const spans = getSharedExporter().getFinishedSpans();
    expect(spans[0].status.message).toBe("execution failed");
    consoleSpy.mockRestore();
  });
});

// ─── Suite 6: timestamp back-calculation ─────────────────────────────────────

describe("XAIPOtelExporter — timestamp back-calculation", () => {
  let exp: XAIPOtelExporter;

  beforeEach(async () => {
    const consoleSpy = suppressConsoleError();
    exp = new XAIPOtelExporter({ serviceName: "ts-test" });
    await exp.init();
    getSharedExporter().reset();
    consoleSpy.mockRestore();
    jest.restoreAllMocks();
  });

  afterEach(async () => {
    const consoleSpy = suppressConsoleError();
    await exp.shutdown();
    consoleSpy.mockRestore();
  });

  it("span endTime is derived from receipt.timestamp", () => {
    const consoleSpy = suppressConsoleError();
    const timestamp = "2026-04-24T00:00:00.000Z";
    const endMs = new Date(timestamp).getTime();
    exp.exportReceipt(makeReceipt({ timestamp, latencyMs: 200 }));
    const span = getSharedExporter().getFinishedSpans()[0];
    // OTel represents time as [seconds, nanoseconds] tuple
    const expectedEndSec = Math.floor(endMs / 1000);
    const expectedEndNs = (endMs % 1000) * 1e6;
    expect(span.endTime[0]).toBe(expectedEndSec);
    expect(span.endTime[1]).toBe(expectedEndNs);
    consoleSpy.mockRestore();
  });

  it("span startTime = endTime − latencyMs", () => {
    const consoleSpy = suppressConsoleError();
    const timestamp = "2026-04-24T00:00:00.000Z";
    const latencyMs = 123;
    const endMs = new Date(timestamp).getTime();
    const startMs = endMs - latencyMs;
    exp.exportReceipt(makeReceipt({ timestamp, latencyMs }));
    const span = getSharedExporter().getFinishedSpans()[0];
    const expectedStartSec = Math.floor(startMs / 1000);
    const expectedStartNs = (startMs % 1000) * 1e6;
    expect(span.startTime[0]).toBe(expectedStartSec);
    expect(span.startTime[1]).toBe(expectedStartNs);
    consoleSpy.mockRestore();
  });

  it("startTime equals endTime when latencyMs is 0", () => {
    const consoleSpy = suppressConsoleError();
    const timestamp = "2026-04-24T00:00:00.000Z";
    const endMs = new Date(timestamp).getTime();
    exp.exportReceipt(makeReceipt({ timestamp, latencyMs: 0 }));
    const span = getSharedExporter().getFinishedSpans()[0];
    expect(span.startTime[0]).toBe(span.endTime[0]);
    expect(span.startTime[1]).toBe(span.endTime[1]);
    consoleSpy.mockRestore();
  });
});

// ─── Suite 7: shutdown() idempotency ─────────────────────────────────────────

describe("XAIPOtelExporter — shutdown() idempotency", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("shutdown() does not throw before init()", async () => {
    const spy = suppressConsoleError();
    const exp = new XAIPOtelExporter({ serviceName: "shutdown-test" });
    await expect(exp.shutdown()).resolves.toBeUndefined();
    spy.mockRestore();
  });

  it("calling shutdown() twice does not throw — pins current behavior", async () => {
    const spy = suppressConsoleError();
    const exp = new XAIPOtelExporter({ serviceName: "shutdown-double" });
    await exp.init();
    await exp.shutdown();
    // Second shutdown: provider is null, so the if-guard skips — safe
    await expect(exp.shutdown()).resolves.toBeUndefined();
    spy.mockRestore();
  });

  it("ready becomes false after shutdown()", async () => {
    const spy = suppressConsoleError();
    const exp = new XAIPOtelExporter({ serviceName: "shutdown-ready" });
    await exp.init();
    expect((exp as any).ready).toBe(true);
    await exp.shutdown();
    // pins current behavior: ready is reset to false on shutdown
    expect((exp as any).ready).toBe(false);
    spy.mockRestore();
  });

  it("exportReceipt after shutdown emits 'Not initialized' error — pins current behavior", async () => {
    // After shutdown, ready=false, so exportReceipt goes to the not-init guard.
    // This is the current behavior: shutdown does not re-enable the exporter.
    const spy = suppressConsoleError();
    const exp = new XAIPOtelExporter({ serviceName: "post-shutdown" });
    await exp.init();
    await exp.shutdown();
    exp.exportReceipt(makeReceipt());
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("Not initialized")
    );
    spy.mockRestore();
  });
});

// ─── Suite 8: graceful degradation when OTel packages fail to load ───────────

describe("XAIPOtelExporter — graceful degradation (require failure path)", () => {
  /**
   * We use jest.isolateModules to load a fresh copy of otel.ts where the
   * @opentelemetry/api require() is made to throw, simulating missing packages.
   */

  it("init() does not throw when OTel packages are unavailable", async () => {
    await jest.isolateModulesAsync(async () => {
      jest.mock(
        "@opentelemetry/api",
        () => {
          throw new Error("Cannot find module '@opentelemetry/api'");
        },
        { virtual: true }
      );
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { XAIPOtelExporter: FreshExporter } = require("../src/otel");
      const consoleSpy = suppressConsoleError();
      const exp = new FreshExporter({ serviceName: "degraded" });
      await expect(exp.init()).resolves.toBeUndefined();
      consoleSpy.mockRestore();
    });
  });

  it("init() emits console.error with package list on load failure", async () => {
    await jest.isolateModulesAsync(async () => {
      jest.mock(
        "@opentelemetry/api",
        () => {
          throw new Error("MODULE_NOT_FOUND");
        },
        { virtual: true }
      );
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { XAIPOtelExporter: FreshExporter } = require("../src/otel");
      const consoleSpy = suppressConsoleError();
      const exp = new FreshExporter();
      await exp.init();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("@opentelemetry/api")
      );
      consoleSpy.mockRestore();
    });
  });

  it("exportReceipt() does not throw after a failed init()", async () => {
    await jest.isolateModulesAsync(async () => {
      jest.mock(
        "@opentelemetry/api",
        () => {
          throw new Error("MODULE_NOT_FOUND");
        },
        { virtual: true }
      );
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { XAIPOtelExporter: FreshExporter } = require("../src/otel");
      const consoleSpy = suppressConsoleError();
      const exp = new FreshExporter();
      await exp.init(); // fails silently
      expect(() => exp.exportReceipt(makeReceipt())).not.toThrow();
      consoleSpy.mockRestore();
    });
  });

  it("shutdown() does not throw after a failed init()", async () => {
    await jest.isolateModulesAsync(async () => {
      jest.mock(
        "@opentelemetry/api",
        () => {
          throw new Error("MODULE_NOT_FOUND");
        },
        { virtual: true }
      );
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { XAIPOtelExporter: FreshExporter } = require("../src/otel");
      const consoleSpy = suppressConsoleError();
      const exp = new FreshExporter();
      await exp.init();
      await expect(exp.shutdown()).resolves.toBeUndefined();
      consoleSpy.mockRestore();
    });
  });
});

// ─── Suite 9: otelPlugin ─────────────────────────────────────────────────────

describe("otelPlugin", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function makeFakeContext(): XAIPContext {
    return {
      did: { method: "key", id: "did:key:plugin-test" },
      publicKey: "pubkey-hex",
      store: {
        log: jest.fn().mockResolvedValue(undefined),
        getReceipts: jest.fn().mockResolvedValue([]),
        getToolNames: jest.fn().mockResolvedValue([]),
        getKeys: jest.fn().mockResolvedValue(null),
        saveKeys: jest.fn().mockResolvedValue(undefined),
        getDidAge: jest.fn().mockResolvedValue(0),
        close: jest.fn().mockResolvedValue(undefined),
      } as unknown as XAIPContext["store"],
    };
  }

  it("plugin has name 'otel'", () => {
    const plugin = otelPlugin();
    expect(plugin.name).toBe("otel");
  });

  it("plugin.init() does not throw with a minimal fake context", async () => {
    const consoleSpy = suppressConsoleError();
    const ctx = makeFakeContext();
    const plugin = otelPlugin({ serviceName: "plugin-test" });
    await expect(plugin.init(ctx)).resolves.toBeUndefined();
    consoleSpy.mockRestore();
  });

  it("plugin.init() wraps ctx.store.log — original log is still called", async () => {
    const consoleSpy = suppressConsoleError();
    const ctx = makeFakeContext();
    const originalLog = ctx.store.log as jest.Mock;
    const plugin = otelPlugin({ serviceName: "plugin-wrap-test" });
    await plugin.init(ctx);

    const receipt = makeReceipt();
    await ctx.store.log(receipt);

    expect(originalLog).toHaveBeenCalledTimes(1);
    expect(originalLog).toHaveBeenCalledWith(receipt);
    consoleSpy.mockRestore();
  });

  it("plugin.init() replaces ctx.store.log with a wrapper function", async () => {
    const consoleSpy = suppressConsoleError();
    const ctx = makeFakeContext();
    const originalLogRef = ctx.store.log;
    const plugin = otelPlugin({ serviceName: "plugin-replace-test" });
    await plugin.init(ctx);
    // The log function is replaced — it's no longer the original reference
    // pins current behavior: ctx.store.log is monkey-patched
    expect(ctx.store.log).not.toBe(originalLogRef);
    consoleSpy.mockRestore();
  });

  it("plugin registers process signal handlers (beforeExit, SIGINT, SIGTERM)", async () => {
    const consoleSpy = suppressConsoleError();
    const onceSpy = jest.spyOn(process, "once");
    const ctx = makeFakeContext();
    const plugin = otelPlugin({ serviceName: "plugin-signal-test" });
    await plugin.init(ctx);

    const registeredEvents = onceSpy.mock.calls.map((c) => c[0]);
    expect(registeredEvents).toContain("beforeExit");
    expect(registeredEvents).toContain("SIGINT");
    expect(registeredEvents).toContain("SIGTERM");

    consoleSpy.mockRestore();
    // Note: process.once listeners are registered but we do not invoke them —
    // they will fire at most once each due to the `once` API and are
    // idempotent due to the internal `called` guard in the closure.
  });

  it("plugin shutdown is idempotent — calling the shutdownOnce closure twice is safe", async () => {
    const consoleSpy = suppressConsoleError();
    // We extract the beforeExit handler and call it twice to verify the
    // `called` guard makes it idempotent.
    let capturedHandler: (...args: unknown[]) => void = () => {};
    jest.spyOn(process, "once").mockImplementation(
      (event: string | symbol, listener: (...args: unknown[]) => void) => {
        if (event === "beforeExit") capturedHandler = listener;
        return process; // satisfy NodeJS.EventEmitter return type
      }
    );

    const ctx = makeFakeContext();
    const plugin = otelPlugin({ serviceName: "plugin-idempotent" });
    await plugin.init(ctx);

    // Call the handler twice — second call should be a no-op
    await expect(
      (async () => {
        await capturedHandler();
        await capturedHandler();
      })()
    ).resolves.toBeUndefined();

    consoleSpy.mockRestore();
  });
});
