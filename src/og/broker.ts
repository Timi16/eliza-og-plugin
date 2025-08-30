import { Wallet, JsonRpcProvider } from "ethers";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createZGComputeNetworkBroker } = require("@0glabs/0g-serving-broker");

export type InferenceRequest = {
  providerAddress: string;
  content: string;
  modelHint?: string;
};

type ChatCompletion = {
  id?: string;
  choices?: Array<{ message?: { content?: string } }>;
  usage?: unknown;
};

export class OgBrokerSession {
  private signer: Wallet;
  private broker: any;

  constructor(privateKey: string, rpcUrl: string) {
    const provider = new JsonRpcProvider(rpcUrl);
    this.signer = new Wallet(privateKey, provider);
  }

  async init() {
    this.broker = await createZGComputeNetworkBroker(this.signer);
    return this;
  }

  async getBalance(): Promise<number> {
    try {
      if (this.broker?.ledger?.getBalance) {
        const b = await this.broker.ledger.getBalance();
        if (typeof b === "number") return b;
        if (b && typeof b.balance === "number") return b.balance;
      }
      return 0;
    } catch {
      return 0;
    }
  }

  async listServices(): Promise<any[]> {
    try {
      const services = await this.broker.listService();
      return Array.isArray(services) ? services : [];
    } catch {
      return [];
    }
  }

  async getServiceMetadata(providerAddress: string): Promise<{ endpoint?: string; model?: string } | null> {
    const services = await this.listServices();
    if (!services.length) throw new Error("No 0G services on this RPC (use Galileo 16601).");
      console.log("0G services[0] →", services[0]); // should include url/endpoint & model

    const lower = (x: string) => (typeof x === "string" ? x.toLowerCase() : "");
    const svc =
      services.find((s: any) => lower(s?.provider) === lower(providerAddress)) ??
      services[0];
    if (!svc) return null;
    const endpoint = (svc as any).url ?? (svc as any).endpoint ?? "";
    const model = (svc as any).model ?? "";
    return { endpoint, model };
  }

  async infer(req: InferenceRequest): Promise<{ raw: ChatCompletion; verified: boolean | null }> {
    const meta = await this.getServiceMetadata(req.providerAddress);
    if (!meta || !meta.endpoint) throw new Error("No endpoint for provider");
    if (!this.broker?.inference?.acknowledgeProviderSigner || !this.broker?.inference?.getRequestHeaders) {
      throw new Error("Broker inference API unavailable");
    }
    await this.broker.inference.acknowledgeProviderSigner(req.providerAddress);
    const headers = await this.broker.inference.getRequestHeaders(req.providerAddress, req.content);
    const res = await fetch(`${meta.endpoint}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({
        messages: [{ role: "user", content: req.content }],
        model: req.modelHint ?? meta.model
      })
    });
    const json = (await res.json()) as ChatCompletion;
    let valid: boolean | null = null;
    try {
      const chatID = json?.id;
      const content = json?.choices?.[0]?.message?.content ?? "";
      if (chatID && content && this.broker?.inference?.processResponse) {
        valid = await this.broker.inference.processResponse(req.providerAddress, content, chatID);
      }
    } catch {
      valid = null;
    }
    return { raw: json, verified: valid };
  }
}
