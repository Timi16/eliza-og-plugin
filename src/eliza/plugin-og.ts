import type { Plugin, Action } from "@elizaos/core";
import type { AgentConfig } from "../config/schema.ts";
import { normalizeOgChatResult } from "../mappers/normalize.ts";
import { assertWithinBudget } from "../guards/policy.ts";
import { OgBrokerSession } from "../og/broker.ts";

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
    handler: async (_runtime, message, _state, _options, callback) => {
      const text =
        (message as any)?.content?.text ??
        (message as any)?.content ??
        JSON.stringify(message);

      assertWithinBudget(agentCfg, 0.001);

      // Do NOT pass modelHint here; prefer provider's model from metadata
      const out = await session.infer({
        providerAddress: defaultProviderAddress,
        content: text
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

  const plugin: Plugin = {
    name: "og-plugin",
    description: "0G compute integration for Eliza actions.",
    actions: [inferAction, listModelsAction, ledgerBalanceAction],
    providers: [],
    evaluators: [],
    services: []
  };

  return plugin;
}
