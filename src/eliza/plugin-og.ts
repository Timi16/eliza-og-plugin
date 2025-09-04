import type { Plugin, Action } from "@elizaos/core";
import type { AgentConfig } from "../config/schema.ts";
import type { ChatMessage, OgBrokerSession } from "../og/broker.js";
import { normalizeOgChatResult } from "../mappers/normalize.js";

type ToolSpec = {
  allow?: string[];
  toolChoice?: "auto" | "none";
  params?: Record<string, unknown>;
  mode?: "pre" | "post" | "both";
};

type BaseInvocation = {
  user: string;
  system?: string;
  context?: {
    text?: string;
    inft?: Record<string, unknown>;
    attachments?: Array<{ url: string; mediaType?: string }>;
  };
  history?: ChatMessage[];
  messages?: ChatMessage[];
  generation?: { temperature?: number; topP?: number; maxTokens?: number; stop?: string[] };
};

type MultiTask = BaseInvocation & {
  id?: string;
  provider?: { address?: string; model?: string };
  tools?: ToolSpec;
};

type Invocation = BaseInvocation & {
  provider?: { address?: string; model?: string };
  tools?: ToolSpec;
  safety?: { notInContextPhrase?: string };
  multi?: MultiTask[];
};

function capHistory(msgs: ChatMessage[], max = 24): ChatMessage[] {
  return msgs.length > max ? msgs.slice(-max) : msgs;
}

function buildMessages(inv: BaseInvocation, fallbackUser: string): ChatMessage[] {
  if (Array.isArray(inv.messages) && inv.messages.length) return capHistory(inv.messages);
  const out: ChatMessage[] = [];
  if (inv.system) out.push({ role: "system", content: inv.system });
  const ctx = inv.context?.text?.trim();
  if (ctx) out.push({ role: "system", content: `CONTEXT:\n${ctx}` });
  if (Array.isArray(inv.history)) {
    for (const m of inv.history) if (m?.role && m?.content) out.push(m);
  }
  out.push({ role: "user", content: inv.user ?? fallbackUser });
  return capHistory(out);
}

export function createOgElizaPlugin(opts: {
  session: OgBrokerSession;
  config: AgentConfig;
  defaultProviderAddress: string;
}): Plugin {
  const { session, config, defaultProviderAddress } = opts;
  const agentCfg = config.agent;

  const inferAction: Action = {
    name: "OG_INFER",
    similes: ["og.infer", "INFER_ON_0G"],
    description: "Send the current user request to 0G provider for inference (supports multi-topic).",
    validate: async () => true,
    handler: async (_runtime, message, _state, options, callback) => {
      const fallbackText =
        (message as any)?.content?.text ??
        (message as any)?.content ??
        JSON.stringify(message);

      const inv = (options?.invocation as Invocation) || { user: fallbackText };

      console.log("invocation", inv);
      console.log(inv.multi," multi?");
      // Single-task path
      if (!Array.isArray(inv.multi) || inv.multi.length === 0) {
        const messages = buildMessages(inv, fallbackText);
        const providerAddress = inv.provider?.address || defaultProviderAddress;
        const modelHint =
          inv.provider?.model ??
          (agentCfg.model && agentCfg.model !== "auto" ? agentCfg.model : "");

        const out = await session.infer({
          providerAddress,
          messages,
          modelHint,
          temperature: inv.generation?.temperature ?? agentCfg.generation?.temperature ?? 0.5,
          topP: inv.generation?.topP ?? agentCfg.generation?.topP ?? 1,
          maxTokens: inv.generation?.maxTokens ?? agentCfg.generation?.maxTokens ?? 1024
        });

        const norm = normalizeOgChatResult(out.raw);
        callback?.({
          text: norm.content ?? inv.safety?.notInContextPhrase ?? "",
          meta: { id: norm.id, verified: out.verified, usage: norm.usage }
        } as any);
        return;
      }

      // // Multi-task path (anime + sports + basketball, etc.)
      // const results: Array<{ id?: string; text: string; meta: any }> = [];

      // for (const task of inv.multi) {

      //   const messages = buildMessages(
      //     {
      //       user: task.user,
      //       system: task.system ?? inv.system,
      //       context: task.context ?? inv.context,
      //       history: task.history ?? inv.history,
      //       messages: task.messages,
      //       generation: task.generation ?? inv.generation
      //     },
      //     fallbackText
      //   );

        
      //   console.log("providerAddress", task.provider?.address, inv.provider?.address, defaultProviderAddress);
      //   const providerAddress = task.provider?.address || inv.provider?.address || defaultProviderAddress;
      //   const modelHint =
      //     task.provider?.model ??
      //     inv.provider?.model ??
      //     (agentCfg.model && agentCfg.model !== "auto" ? agentCfg.model : undefined);

      //   const out = await session.infer({
      //     providerAddress,
      //     messages,
      //     modelHint,
      //     temperature:
      //       task.generation?.temperature ??
      //       inv.generation?.temperature ??
      //       agentCfg.generation?.temperature,
      //     topP:
      //       task.generation?.topP ??
      //       inv.generation?.topP ??
      //       agentCfg.generation?.topP,
      //     maxTokens:
      //       task.generation?.maxTokens ??
      //       inv.generation?.maxTokens ??
      //       agentCfg.generation?.maxTokens
      //   });

      //   const norm = normalizeOgChatResult(out.raw);
      //   results.push({
      //     id: task.id,
      //     text: norm.content ?? inv.safety?.notInContextPhrase ?? "",
      //     meta: { id: norm.id, verified: out.verified, usage: norm.usage }
      //   });
      // }


      // const joined = results
      //   .map(r => (r.id ? `# ${r.id}\n${r.text}` : r.text))
      //   .join("\n\n");

      // callback?.({
      //   text: joined,
      //   data: { results },
      //   meta: { multi: true }
      // } as any);
    },
    examples: []
  };

  const listModelsAction: Action = {
    name: "OG_MODELS_LIST",
    similes: ["og.models.list"],
    description: "List available 0G services/models.",
    validate: async () => true,
    handler: async (_runtime, _message, _state, _options, callback) => {
      const services = await session.listServices();
      callback?.({ data: services } as any);
    },
    examples: []
  };

  const ledgerBalanceAction: Action = {
    name: "OG_LEDGER_BALANCE",
    similes: ["og.ledger.balance"],
    description: "Get ledger balance for current signer (provider-specific).",
    validate: async () => true,
    handler: async (_runtime, _message, _state, _options, callback) => {
      const balance = await session.getBalance();
      callback?.({ data: { balanceA0GI: balance } } as any);
    },
    examples: []
  };

  return {
    name: "og-plugin",
    description: "0G compute integration for Eliza actions.",
    actions: [inferAction, listModelsAction, ledgerBalanceAction],
    providers: [],
    evaluators: [],
    services: []
  };
}

//Send Transactions and Wallet Balance 2 actions