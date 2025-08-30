import "dotenv/config";
import { readFileSync } from "node:fs";
import { AgentRuntime, type HandlerCallback, type Memory } from "@elizaos/core";
import { bootstrapPlugin } from "@elizaos/plugin-bootstrap";
import { createOgPluginFromEnv } from "../src/index.ts";

const config = JSON.parse(
  readFileSync(new URL("./agent.config.json", import.meta.url), "utf-8")
);

const J = (v: any) =>
  JSON.stringify(
    v,
    (_k, val) => (typeof val === "bigint" ? val.toString() : val),
    2
  );

async function runAction(
  runtime: AgentRuntime,
  plugin: any,
  name: string,
  messageText: string
) {
  const action = (plugin.actions ?? []).find((a: any) => a.name === name);
  if (!action) throw new Error(`Action ${name} not found`);

  console.log(`\n\n=== ACTION → ${name} ===`);
  console.log(`> "${messageText}"\n`);

  const msg = { content: { text: messageText } } as any;
  const cb: HandlerCallback = async (out) => {
    console.log(J(out));
    return [] as Memory[];
  };

  await action.handler(runtime as any, msg, {} as any, {}, cb);
}

async function main() {
  const ogPlugin = await createOgPluginFromEnv(config);
  const runtime = new AgentRuntime({ plugins: [bootstrapPlugin, ogPlugin] });

  await runAction(runtime, ogPlugin, "OG_MODELS_LIST", "What models can you run?");
  await runAction(runtime, ogPlugin, "OG_LEDGER_BALANCE", "What's my 0G balance?");
  await runAction(runtime, ogPlugin, "OG_INFER", "Summarize DeLabz in 2 lines.");
  await runAction(runtime, ogPlugin, "OG_MODELS_LIST", "List available models");
  await runAction(runtime, ogPlugin, "OG_LEDGER_BALANCE", "Show my ledger balance");
  await runAction(runtime, ogPlugin, "OG_INFER", "Write a 1-paragraph about Og");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
