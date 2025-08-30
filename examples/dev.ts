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
  const runtime = new AgentRuntime({ plugins: [bootstrapPlugin, ogPlugin] });

  const infer = (ogPlugin.actions ?? []).find(a => a.name === "OG_INFER")!;

  const cb: HandlerCallback = async (out) => {
    console.log("OG Inference →", out);
    return [] as Memory[];
  };

  // Example: context + system + history in one invocation
  const invocation = {
    user: "Who becomes Commander after Erwin?",
    system: "You are an anime QA agent. Answer strictly from the given context.",
    context: { text: "Attack on Titan notes: Hange Zoë becomes Commander after Erwin." },
    history: [
      { role: "user", content: "Summarize Survey Corps leadership." },
      { role: "assistant", content: "Erwin -> Hange; Levi serves under command." }
    ],
    generation: { temperature: 0.3, maxTokens: 256 }
  };

  const message = { content: { text: invocation.user } } as any;
  await infer.handler(runtime, message, {} as any, { invocation }, cb);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
