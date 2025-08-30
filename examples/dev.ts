import "dotenv/config";
import { readFileSync } from "node:fs";
import { AgentRuntime, type HandlerCallback, type Memory } from "@elizaos/core";
import { bootstrapPlugin } from "@elizaos/plugin-bootstrap";
import { createOgPluginFromEnv } from "../src/index.ts";

const config = JSON.parse(
  readFileSync(new URL("./agent.config.json", import.meta.url), "utf-8")
);

async function main() {
  const ogPlugin = await createOgPluginFromEnv(config);

  const runtime = new AgentRuntime({
    plugins: [bootstrapPlugin, ogPlugin],
  });

  const message = { content: { text: "Summarize DeLabz in 2 lines." } } as any;

  const infer = (ogPlugin.actions ?? []).find((a: { name: string; }) => a.name === "OG_INFER")!;

  const cb: HandlerCallback = async (out) => {
    console.log("OG Inference →", out);
    return [] as Memory[];
  };

  await infer.handler(runtime, message, {} as any, {}, cb);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
