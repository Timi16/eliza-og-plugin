import type { Plugin, Action } from "@elizaos/core";
import type { AgentConfig } from "../config/schema.ts";
import { normalizeOgChatResult } from "../mappers/normalize.ts";
import { assertWithinBudget } from "../guards/policy.ts";
import { OgBrokerSession, type ChatMessage } from "../og/broker.ts";

type Invocation = {
  user: string;
  system?: string;
  context?: { text?: string };
  history?: ChatMessage[];
  messages?: ChatMessage[];
  generation?: { temperature?: number; topP?: number; maxTokens?: number; stop?: string[] };
  provider?: { address?: string; model?: string };
  safety?: { notInContextPhrase?: string };
};

function capHistory(msgs: ChatMessage[], max = 24): ChatMessage[] {
  return msgs.length > max ? msgs.slice(-max) : msgs;
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
    description: "Send the current user request to 0G provider for inference.",
    validate: async () => true,
    handler: async (_runtime, message, _state, options, callback) => {
      const fallbackText =
        (message as any)?.content?.text ??
        (message as any)?.content ??
        JSON.stringify(message);

      const inv = (options?.invocation ?? {}) as Invocation;
      assertWithinBudget(agentCfg, 0.001);

      let messages: ChatMessage[] = [];
      if (Array.isArray(inv.messages) && inv.messages.length) {
        messages = inv.messages;
      } else {
        if (inv.system) messages.push({ role: "system", content: inv.system });
        const ctxText = inv.context?.text;
        if (ctxText && ctxText.trim()) {
          messages.push({ role: "system", content: `CONTEXT:\n${ctxText.trim()}` });
        }
        if (Array.isArray(inv.history)) {
          for (const m of inv.history) if (m?.role && m?.content) messages.push(m);
        }
        const userText = inv.user ?? fallbackText;
        messages.push({ role: "user", content: userText });
      }
      messages = capHistory(messages);

      const providerAddress = inv.provider?.address || defaultProviderAddress;
      // allow "auto" which triggers broker discovery
      const modelHint =
        inv.provider?.model ??
        (agentCfg.model && agentCfg.model !== "auto" ? agentCfg.model : undefined);

      const out = await session.infer({
        providerAddress,
        messages,
        modelHint,
        temperature: inv.generation?.temperature ?? agentCfg.generation?.temperature,
        topP: inv.generation?.topP ?? agentCfg.generation?.topP,
        maxTokens: inv.generation?.maxTokens ?? agentCfg.generation?.maxTokens
      });

      const norm = normalizeOgChatResult(out.raw);
      callback?.({
        text: norm.content ?? inv.safety?.notInContextPhrase ?? "",
        meta: { id: norm.id, verified: out.verified, usage: norm.usage }
      } as any);
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
