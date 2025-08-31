import "dotenv/config";
import { OgBrokerSession } from "./og/broker.ts";
import { AgentConfigSchema, type AgentConfig } from "./config/schema.ts";
import { createOgElizaPlugin } from "./eliza/plugin-og.ts";

export async function createOgPluginFromEnv(configJson: unknown) {
  const parsed: AgentConfig = AgentConfigSchema.parse(configJson);

  const pk = process.env.PRIVATE_KEY ?? "0x5c3a638856b1b708f5e75d4831d700208eef4c2484eb59dd817ce25cdd918ad4";
  const rpc = process.env.RPC_URL ?? "https://evmrpc-testnet.0g.ai";
  const providerAddr = process.env.OG_PROVIDER_ADDRESS ?? "0xf07240Efa67755B5311bc75784a061eDB47165Dd";

  if (!pk || !rpc) {
    throw new Error("Missing PRIVATE_KEY or RPC_URL");
  }

  const session = await new OgBrokerSession(pk, rpc).init();
  return createOgElizaPlugin({
    session,
    config: parsed,
    defaultProviderAddress: providerAddr
  });
}

export { createOgElizaPlugin, OgBrokerSession, AgentConfigSchema };
