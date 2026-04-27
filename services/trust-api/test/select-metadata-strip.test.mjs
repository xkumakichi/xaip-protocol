import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { build } from "esbuild";

const bundled = await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  format: "esm",
  platform: "browser",
  write: false,
});

const code = bundled.outputFiles[0].text;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
const worker = (await import(moduleUrl)).default;

const observedToolMetadata = {
  toolClass: "settlement",
  verifiabilityHint: "anchored",
  settlementLayer: "xrpl-testnet",
  observedAt: "2026-04-24T00:00:00.000Z",
  source: "latest_observed_receipt",
};

const env = {
  XAIP_VERSION: "test",
  AGGREGATOR_NODES: "https://xaip-aggregator.test",
  AGGREGATOR_SERVICE: {
    async fetch() {
      return Response.json({
        result: {
          verdict: "yes",
          trust: 0.91,
          riskFlags: [],
          meta: { sampleSize: 42 },
          observedToolMetadata,
        },
        source: "test-aggregator",
      });
    },
  },
};

const trustResponse = await worker.fetch(
  new Request("https://trust.test/v1/trust/context7"),
  env
);
assert.equal(trustResponse.status, 200);
const trustBody = await trustResponse.json();
assert.deepEqual(trustBody.observedToolMetadata, observedToolMetadata);

const selectResponse = await worker.fetch(
  new Request("https://trust.test/v1/select", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      task: "Choose a tool",
      candidates: ["context7", "filesystem"],
    }),
  }),
  env
);
assert.equal(selectResponse.status, 200);
const selectBody = await selectResponse.json();
assert.equal(selectBody.candidates.length, 2);
for (const candidate of selectBody.candidates) {
  assert.equal(
    Object.hasOwn(candidate, "observedToolMetadata"),
    false,
    "/v1/select candidates must not expose display-only observed metadata"
  );
}

