import "dotenv/config";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { AgentRuntime, type HandlerCallback, type Memory } from "@elizaos/core";
import { bootstrapPlugin } from "@elizaos/plugin-bootstrap";
import { createOgPluginFromEnv } from "../src/index.ts";

type OGUsage = { total_tokens?: number; prompt_tokens?: number; completion_tokens?: number; [k: string]: unknown };
type OGMeta  = { id?: string | null; verified?: boolean | null; usage?: OGUsage | null };
type OGOut   = { text?: string; meta?: OGMeta | null };


const profile = {
  system: [
    "You are Kitsu, an anime archivist.",
    "",
    "STRICT MODE:",
    "- You MUST answer ONLY from the provided CONTEXT.",
    `- If the CONTEXT does not contain the answer, reply exactly`,
    "- use general knowledge from context, the web, do not use any assumptions.",
    "- Keep answers concise (1 short sentence).",
    "- Do not add prefaces or explanations.",
  ].join("\n"),

  context: [
    "Attack on Titan — curated notes",
    "",
    "Survey Corps leadership:",
    "- Erwin Smith serves as 13th Commander of the Survey Corps.",
    "- After Erwin’s death at Shiganshina, Hange Zoë becomes the 14th Commander.",
    "- Later, Armin Arlert is appointed as the 15th Commander.",
    "- Levi Ackerman is a captain, famed as 'humanity’s strongest soldier'.",
    "",
    "Nine Titans & notable inheritors (mainline period):",
    "- Founding Titan (a.k.a. the 'Coordinate'): Frieda Reiss → taken by Grisha Yeager → inherited by Eren Yeager.",
    "- Attack Titan: Kruger → Grisha Yeager → Eren Yeager.",
    "- Colossal (Colossus) Titan: Bertholdt Hoover → Armin Arlert.",
    "- Armored Titan: Reiner Braun.",
    "- Female Titan: Annie Leonhart.",
    "- Beast Titan: Zeke Yeager.",
    "- War Hammer Titan: Lara Tybur → Eren Yeager.",
    "- Cart Titan: Pieck Finger.",
    "- Jaw Titan: Marcel Galliard → Ymir → Porco Galliard → Falco Grice.",
    "",
    "Founding Titan / 'Coordinate' rules:",
    "- Full control of Subjects of Ymir requires royal blood (Reiss/Fritz) OR direct physical contact between the Founding Titan holder and a royal-blooded Titan.",
    "- Royal holders were constrained by the First King’s pacifist ideology; a non-royal holder can bypass that ideology via contact with royal blood.",
    "",
    "Reiss family & the chapel incident:",
    "- Grisha Yeager confronts the Reiss family in the underground chapel and takes the Founding Titan from Frieda Reiss.",
    "- Grisha later transfers both the Attack and Founding Titans to Eren Yeager.",
    "",
    "The Rumbling (what, how):",
    "- Eren Yeager triggers the Rumbling by accessing the Founding Titan’s power in contact with Zeke (royal blood), undoing hardening and commanding the Wall Titans.",
    "",
    "Other facts frequently asked:",
    "- Historia Reiss becomes queen after overthrowing the puppet regime.",
    "- ODM gear enables 3D movement for soldiers against Titans.",
    "- Mikasa Ackerman and Levi Ackerman exhibit enhanced combat aptitude linked to the Ackerman lineage.",
  ].join("\n")
};

function icon(v?: boolean | null) {
  return v === true ? "✔" : v === false ? "✖" : "–";
}

async function main() {
  const config = JSON.parse(readFileSync(new URL("./agent.config.json", import.meta.url), "utf-8"));
  const ogPlugin = await createOgPluginFromEnv(config);
  const runtime = new AgentRuntime({ plugins: [bootstrapPlugin, ogPlugin] });
  const infer = (ogPlugin.actions ?? []).find((a) => a.name === "OG_INFER")!;
  const rl = createInterface({ input, output });

  console.log("\n" + "─".repeat(60));
  console.log("Ask about Attack on Titan (strict context)");
  console.log("─".repeat(60) + "\n");

  const question = (await rl.question("Your question: ")).trim();
  await rl.close();
  if (!question) {
    console.error("No question provided.");
    process.exit(1);
  }

  const invocation = {
    generation: { temperature: 0.0, maxTokens: 96, topP: 1 },
    messages: [
      { role: "system", content: profile.system },
      { role: "system", content: `CONTEXT:\n${profile.context}` },
      { role: "user", content: question }
    ]
  };

  const cb: HandlerCallback = async (raw) => {
    const out  = (raw as OGOut) ?? {};
    const meta = out.meta ?? {};
    const usage = (meta.usage ?? {}) as OGUsage;

    let answer = String(out.text ?? "").trim();


    console.log("\nAnswer:", answer);

    return [] as Memory[];
  };

  await infer.handler(runtime, { content: { text: "" } } as any, {} as any, { invocation }, cb);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
