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

  const infer = (ogPlugin.actions ?? []).find(
    (a: { name: string }) => a.name === "OG_INFER"
  )!;
  const cb: HandlerCallback = async (out) => {
    console.log(out?.text ?? out);
    return [] as Memory[];
  };

  const system =
    "You are an anime QA assistant. Answer only from the provided CONTEXT. If a question cannot be answered from the context, reply exactly: Not in context.";

  const context = `
Title: Attack on Titan
Setting: A world where humanity lives within three concentric Walls (Maria, Rose, Sina) to protect against man-eating Titans.
Key Groups: Survey Corps (scouts outside the Walls), Military Police (inner security), Garrison (defense of Walls).
Main Characters:
- Eren Yeager: can transform into a Titan; driven to eradicate Titans.
- Mikasa Ackerman: elite fighter, protective of Eren.
- Armin Arlert: strategist, later inherits the Colossal Titan.
- Erwin Smith: former Commander of the Survey Corps; succeeded by Hange Zoë.
Core Tech: ODM gear enables high-mobility combat against Titans.
Major Plot Beats (abridged):
- Titans breach Wall Maria; Eren vows revenge.
- Eren learns to transform; joins the Survey Corps.
- Marley vs Eldia conflict is revealed; Titans originate from Eldian paths/Ymir power.
- The Rumbling is triggered by Eren using the Founding Titan, unleashing the Wall Colossals.
Relationships:
- Mikasa is not Eren's blood relative; she is an adopted member of the Yeager household after being rescued.
- Levi is an Ackerman; serves under Erwin, later Hange.
Notes:
- Rumbling trigger: Eren gains control of the Founding Titan and activates the Wall Titans.
- Hange Zoë becomes Survey Corps Commander after Erwin.
End of context.
`.trim();

  const options = {
    system: `${system}\n\nCONTEXT:\n${context}`,
    temperature: 0.3,
    maxTokens: 256
  };

  const questions = [
    "Who becomes Commander of the Survey Corps after Erwin?",
    "What exactly triggers the Rumbling?",
    "What is ODM gear used for?",
    "What is Mikasa's relation to Eren?",
    "Name the three Walls.",
    "Who inherits the Colossal Titan later?"
  ];

  for (const q of questions) {
    console.log(`\nQ: ${q}`);
    const message = { content: { text: q } } as any;
    await infer.handler(runtime, message, {} as any, options, cb);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
