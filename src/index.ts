import "dotenv/config";
import { OgBrokerSession } from "./og/broker.ts";
import { AgentConfigSchema, type AgentConfig } from "./config/schema.ts";
import { createOgElizaPlugin } from "./eliza/plugin-og.ts";


export async function createOgPluginFromEnv(configJson: unknown) {
  const parsed: AgentConfig = AgentConfigSchema.parse(configJson);
  const pk ="0x5c3a638856b1b708f5e75d4831d700208eef4c2484eb59dd817ce25cdd918ad4";
  const rpc ="https://16601.rpc.thirdweb.com"; // Galileo
  const providerAddr ="0xcD690Cda4143A1D48c7e7A7fC63ca76CDB92aCCF";

  if (!pk || !rpc) {
    throw new Error("Missing PRIVATE_KEY or RPC_URL/ZG_RPC_URL");
  }

  const session = await new OgBrokerSession(pk, rpc).init();
  return createOgElizaPlugin({
    session,
    config: parsed,
    defaultProviderAddress: providerAddr
  });
}

export { createOgElizaPlugin, OgBrokerSession, AgentConfigSchema };
