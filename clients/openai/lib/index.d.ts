export type XAIPClassHint =
  | "advisory"
  | "data-retrieval"
  | "computation"
  | "mutation"
  | "settlement";

export interface RunWithXAIPParams<T = unknown> {
  toolName: string;
  input: unknown;
  run: () => T | Promise<T>;
  classHint?: XAIPClassHint;
  aggregatorUrl?: string;
  disabled?: boolean;
}

export function runWithXAIP<T = unknown>(params: RunWithXAIPParams<T>): Promise<T>;

export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface OpenAIToolMessage {
  role: "tool";
  tool_call_id: string;
  content: string;
}

export interface ExecuteToolCallsOptions {
  aggregatorUrl?: string;
  disabled?: boolean;
  classifyTool?: (toolName: string) => XAIPClassHint | null | undefined;
}

export function executeToolCalls(
  toolCalls: OpenAIToolCall[] | null | undefined,
  toolMap: Record<string, (args: any) => any | Promise<any>>,
  opts?: ExecuteToolCallsOptions
): Promise<OpenAIToolMessage[]>;
