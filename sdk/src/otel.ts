/**
 * XAIP OpenTelemetry Exporter — Export execution receipts as OTel Spans.
 *
 * Each ExecutionReceipt maps to one span:
 *   - Span name:  xaip.tool.{toolName}
 *   - Attributes: xaip.agent.did, xaip.tool.name, xaip.task.hash, etc.
 *   - Status:     OK on success, ERROR on failure
 *   - Duration:   latencyMs
 *
 * OTel packages are required but treated as optional — import failure
 * emits a console.error and degrades gracefully without throwing.
 *
 * Usage (direct):
 *   const exporter = new XAIPOtelExporter({ serviceName: "my-agent" });
 *   await exporter.init();
 *   exporter.exportReceipt(receipt);
 *   await exporter.shutdown();
 *
 * Usage (plugin):
 *   await withXAIP(server, {
 *     plugins: [otelPlugin()]
 *   });
 */

import { ExecutionReceipt, XAIPPlugin, XAIPContext } from "./types";

// ─── OTel type stubs (resolved at runtime) ──────────────────────────────────

type OtelApi = typeof import("@opentelemetry/api");
type OtelSdkTrace = typeof import("@opentelemetry/sdk-trace-node");
type OtelExporter = typeof import("@opentelemetry/exporter-trace-otlp-http");

// ─── Config ──────────────────────────────────────────────────────────────────

export interface OtelExporterConfig {
  /** Service name reported to OTel backend. Default: "xaip-agent" */
  serviceName?: string;
  /** OTLP HTTP endpoint. Default: "http://localhost:4318/v1/traces" */
  endpoint?: string;
}

// ─── XAIPOtelExporter ────────────────────────────────────────────────────────

export class XAIPOtelExporter {
  private readonly serviceName: string;
  private readonly endpoint: string;

  private api: OtelApi | null = null;
  private provider: any = null; // NodeTracerProvider
  private tracer: any = null;   // Tracer
  private ready = false;

  constructor(config?: OtelExporterConfig) {
    this.serviceName = config?.serviceName ?? "xaip-agent";
    this.endpoint = config?.endpoint ?? "http://localhost:4318/v1/traces";
  }

  /**
   * Initialize TracerProvider with OTLP HTTP exporter.
   * Safe to call multiple times — subsequent calls are no-ops.
   */
  async init(): Promise<void> {
    if (this.ready) return;

    let sdkTrace: OtelSdkTrace;
    let exporterMod: OtelExporter;
    let api: OtelApi;

    try {
      api = require("@opentelemetry/api") as OtelApi;
      sdkTrace = require("@opentelemetry/sdk-trace-node") as OtelSdkTrace;
      exporterMod = require(
        "@opentelemetry/exporter-trace-otlp-http"
      ) as OtelExporter;
    } catch (e: any) {
      console.error(
        `[xaip:otel] Failed to load OpenTelemetry packages: ${e?.message ?? e}. ` +
          "Ensure @opentelemetry/api, @opentelemetry/sdk-trace-node, and " +
          "@opentelemetry/exporter-trace-otlp-http are installed."
      );
      return;
    }

    this.api = api;

    const otlpExporter = new exporterMod.OTLPTraceExporter({
      url: this.endpoint,
    });

    // @opentelemetry/resources v2 uses resourceFromAttributes (no Resource class)
    let resource: any;
    try {
      const { resourceFromAttributes } = require("@opentelemetry/resources");
      resource = resourceFromAttributes({ "service.name": this.serviceName });
    } catch {
      resource = undefined;
    }

    // NodeTracerProvider v2.x: spanProcessors passed in constructor
    const providerConfig: any = {
      spanProcessors: [new sdkTrace.SimpleSpanProcessor(otlpExporter)],
    };
    if (resource !== undefined) {
      providerConfig.resource = resource;
    }

    const provider = new sdkTrace.NodeTracerProvider(providerConfig);

    provider.register();

    this.provider = provider;
    this.tracer = api.trace.getTracer("xaip-sdk");
    this.ready = true;

    console.error(
      `[xaip:otel] Initialized. service="${this.serviceName}" endpoint="${this.endpoint}"`
    );
  }

  /**
   * Export a single ExecutionReceipt as an OTel Span.
   * The span start/end time is back-calculated from receipt.timestamp and latencyMs.
   */
  exportReceipt(receipt: ExecutionReceipt): void {
    if (!this.ready || !this.tracer || !this.api) {
      console.error("[xaip:otel] Not initialized — call init() first");
      return;
    }

    const spanName = `xaip.tool.${receipt.toolName}`;

    // Reconstruct wall-clock timestamps from receipt data
    const endTime = new Date(receipt.timestamp).getTime();
    const startTime = endTime - receipt.latencyMs;

    const span = this.tracer.startSpan(spanName, {
      startTime,
    });

    // ─── Attributes ──────────────────────────────────
    span.setAttribute("xaip.agent.did", receipt.agentDid);
    span.setAttribute("xaip.tool.name", receipt.toolName);
    span.setAttribute("xaip.task.hash", receipt.taskHash);
    span.setAttribute("xaip.result.hash", receipt.resultHash);
    span.setAttribute("xaip.success", receipt.success);
    span.setAttribute("xaip.latency_ms", receipt.latencyMs);
    span.setAttribute(
      "xaip.cosigned",
      receipt.callerSignature !== undefined && receipt.callerSignature !== null
    );

    if (receipt.callerDid !== undefined && receipt.callerDid !== null) {
      span.setAttribute("xaip.caller.did", receipt.callerDid);
    }
    if (receipt.failureType !== undefined && receipt.failureType !== null) {
      span.setAttribute("xaip.failure_type", receipt.failureType);
    }

    // ─── Span status ─────────────────────────────────
    const { SpanStatusCode } = this.api;
    if (receipt.success) {
      span.setStatus({ code: SpanStatusCode.OK });
    } else {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: receipt.failureType ?? "execution failed",
      });
    }

    span.end(endTime);
  }

  /** Flush pending spans and shut down the TracerProvider. */
  async shutdown(): Promise<void> {
    if (this.provider) {
      await this.provider.shutdown();
      this.ready = false;
      this.provider = null;
      this.tracer = null;
      console.error("[xaip:otel] Shutdown complete");
    }
  }
}

// ─── otelPlugin ─────────────────────────────────────────────────────────────

/**
 * XAIP plugin that initializes OTel and hooks store.log to export every
 * receipt as a span automatically.
 *
 * @example
 * await withXAIP(server, {
 *   plugins: [otelPlugin({ serviceName: "my-agent" })]
 * });
 */
export function otelPlugin(config?: OtelExporterConfig): XAIPPlugin {
  return {
    name: "otel",

    async init(ctx: XAIPContext): Promise<void> {
      const exporter = new XAIPOtelExporter(config);
      await exporter.init();

      // Patch store.log to forward every new receipt to OTel.
      // The original method is preserved; we wrap it.
      const originalLog = ctx.store.log.bind(ctx.store);
      ctx.store.log = async (receipt: ExecutionReceipt): Promise<void> => {
        await originalLog(receipt);
        exporter.exportReceipt(receipt);
      };

      // Graceful shutdown on process exit
      const shutdownOnce = (() => {
        let called = false;
        return async () => {
          if (called) return;
          called = true;
          await exporter.shutdown();
        };
      })();

      process.once("beforeExit", shutdownOnce);
      process.once("SIGINT", shutdownOnce);
      process.once("SIGTERM", shutdownOnce);
    },
  };
}
