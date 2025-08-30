import type { Plugin, Action } from "@elizaos/core";
import type { AgentConfig } from "../config/schema.ts";
import { normalizeOgChatResult } from "../mappers/normalize.ts";
import { assertWithinBudget } from "../guards/policy.ts";
import { OgBrokerSession, type ChatMessage } from "../og/broker.ts";

type OgInferOptions = {
  system?: string;
  history?: ChatMessage[];
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  messages?: ChatMessage[]; // if provided, used verbatim
};

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
      const text =
        (message as any)?.content?.text ??
        (message as any)?.content ??
        JSON.stringify(message);

      assertWithinBudget(agentCfg, 0.001);

      const opt = (options ?? {}) as OgInferOptions;

      // Build messages (prefer verbatim, else compose from system/history/user)
      let messages: ChatMessage[];
      if (Array.isArray(opt.messages) && opt.messages.length) {
        messages = opt.messages;
      } else {
        messages = [];
        if (opt.system && typeof opt.system === "string") {
          messages.push({ role: "system", content: opt.system });
        }
        if (Array.isArray(opt.history)) {
          for (const m of opt.history) {
            if (m?.role && m?.content) messages.push(m);
          }
        }
        messages.push({ role: "user", content: text });
      }

      // Optional: lightweight cap to avoid runaway history sizes
      if (messages.length > 24) messages = messages.slice(-24);

      const out = await session.infer({
        providerAddress: defaultProviderAddress,
        messages,
        modelHint: agentCfg.model || undefined,                 // only used if provider didn't advertise
        temperature: opt.temperature ?? agentCfg.generation?.temperature,
        topP: opt.topP ?? agentCfg.generation?.topP,
        maxTokens: opt.maxTokens ?? agentCfg.generation?.maxTokens
      });

      const norm = normalizeOgChatResult(out.raw);
      callback?.({
        text: norm.content,
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
