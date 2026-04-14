import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["-y", "@upstash/context7-mcp"],
    env: process.env as Record<string, string>,
    stderr: "pipe",
  });

  const client = new Client(
    { name: "test", version: "1.0.0" },
    { capabilities: {} },
  );

  await client.connect(transport);
  console.log("Connected");

  const tools = await client.listTools();
  for (const t of tools.tools) {
    console.log(`\nTool: ${t.name}`);
    console.log(`Schema: ${JSON.stringify(t.inputSchema, null, 2)}`);
  }

  // Try calling resolve-library-id
  console.log("\n--- Calling resolve-library-id ---");
  try {
    const result = await client.callTool(
      { name: "resolve-library-id", arguments: { query: "react" } },
      undefined,
      { timeout: 15000 },
    );
    console.log("Result:", JSON.stringify(result, null, 2).slice(0, 500));
  } catch (err: any) {
    console.log("Error:", err.message);
  }

  await client.close();
}
main();
