import "dotenv/config";
import { readFileSync } from "node:fs";
import { AgentRuntime, type HandlerCallback, type Memory } from "@elizaos/core";
import { bootstrapPlugin } from "@elizaos/plugin-bootstrap";
import { createOgPluginFromEnv } from "../src/index.ts";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

// ---- tiny ANSI helpers for nicer console output ----
const c = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};
function bar(label = "OG Inference") {
  const line = "─".repeat(60);
  console.log(`\n${line}\n${c.bold(label)}\n${line}\n`);
}

// ---- minimal result shapes to keep TS happy when printing ----
type OGUsage = {
  total_tokens?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  [k: string]: unknown;
};
type OGMeta = { id?: string | null; verified?: boolean | null; usage?: OGUsage | null };
type OGOut = { text?: string; meta?: OGMeta | null };

async function main() {
  // 1) Load your agent config (model, budgets, defaults)
  const config = JSON.parse(
    readFileSync(new URL("./agent.config.json", import.meta.url), "utf-8")
  );

  // 2) Build the OG plugin + Eliza runtime
  const ogPlugin = await createOgPluginFromEnv(config);
  const runtime = new AgentRuntime({ plugins: [bootstrapPlugin, ogPlugin] });
  const infer = (ogPlugin.actions ?? []).find((a) => a.name === "OG_INFER")!;

  // 3) Define your “DVD profile”: just SYSTEM + CONTEXT for Attack on Titan
  const profile = {
    system:
      "You are an anime QA assistant. Answer concisely and ONLY from the provided context. " +
      "If the answer isn’t in context, say: 'Not in provided context.'",
    context:
      "Attack on Titan quick notes:\n" +
      "- Hange Zoë becomes Commander of the Survey Corps after Erwin Smith.\n" +
      "- Armin Arlert inherits the Colossal Titan.\n" +
      "- The Rumbling is triggered when Eren uses the Founding Titan’s power via contact with a royal-blooded Titan.\n" +
      "- Levi Ackerman is humanity’s strongest soldier and serves under the Commander.\n",
  };

  // 4) Collect just the USER QUESTION from terminal
  const rl = createInterface({ input, output });
  bar("Ask about Attack on Titan");
  const question = (await rl.question(`${c.cyan("Your question")}: `)).trim();
  await rl.close();

  if (!question) {
    console.error("No question provided. Exiting.");
    process.exit(1);
  }

  // 5) Build invocation with ONLY system + context + the user’s question as messages
  //    (we do NOT use `invocation.user`; we send a ready-made messages array)
  const invocation = {
    generation: { temperature: 0.2, maxTokens: 256 },
    // send raw messages so the plugin uses them directly
    messages: [
      { role: "system", content: profile.system },
      { role: "system", content: `CONTEXT:\n${profile.context}` },
      { role: "user", content: question },
    ],
  };

  // 6) Eliza requires a `message` param but we won’t use it (plugin will take `invocation.messages`)
  const dummyMessage = { content: { text: "" } } as any;

  // 7) Pretty-print the result
  const cb: HandlerCallback = async (outAny) => {
    const out = (outAny as OGOut) ?? {};
    const txt = (out.text ?? "").toString().trim();
    const meta = out.meta ?? {};
    const usage = (meta.usage ?? {}) as OGUsage;
    const verified = meta.verified === true ? "✔" : meta.verified === false ? "✖" : "–";

    console.log(c.green("\nAnswer:"), txt || "Not in provided context.");
    console.log(
      c.dim(
        `\nid=${meta.id ?? "null"} | verified=${verified} | tokens: total=${
          usage.total_tokens ?? "?"
        }, prompt=${usage.prompt_tokens ?? "?"}, completion=${usage.completion_tokens ?? "?"}`
      )
    );
    return [] as Memory[];
  };

  // 8) Fire once
  await infer.handler(runtime, dummyMessage, {} as any, { invocation }, cb);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
