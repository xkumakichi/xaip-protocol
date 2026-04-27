import type { BaseCallbackHandler } from "@langchain/core/callbacks/base";

export type XAIPClassHint =
  | "advisory"
  | "data-retrieval"
  | "computation"
  | "mutation"
  | "settlement";

export interface XAIPCallbackHandlerOptions {
  /** Override the aggregator endpoint. Defaults to the public Cloudflare worker. */
  aggregatorUrl?: string;
  /** If true, no receipts are emitted. Honors `process.env.XAIP_DISABLED === "1"`. */
  disabled?: boolean;
  /**
   * Optional XAIP v0.5 class hint per tool. The returned class is attached as
   * `receipt.toolMetadata.xaip.class`. Aggregators that don't
   * recognize the field ignore it (forward-compatible).
   */
  classifyTool?: (toolName: string) => XAIPClassHint | null | undefined;
}

export class XAIPCallbackHandler extends BaseCallbackHandler {
  constructor(opts?: XAIPCallbackHandlerOptions);
  name: string;
  aggregatorUrl: string;
  disabled: boolean;
  copy(): this;
  handleToolStart(tool: unknown, input: unknown, runId: string): Promise<void>;
  handleToolEnd(output: unknown, runId: string): Promise<void>;
  handleToolError(err: unknown, runId: string): Promise<void>;
}

export default XAIPCallbackHandler;
