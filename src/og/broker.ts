// src/og/broker.ts
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

type ServiceRecord = {
  provider: string;
  serviceType: string;
  url: string;
  inputPrice: bigint | string | number;
  outputPrice: bigint | string | number;
  updatedAt: bigint | string | number;
  model?: string;
  verifiability?: string;
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
      const ledger =
        (await this.broker?.ledger?.getLedger?.()) ??
        (await this.broker?.ledger?.getLedger?.(this.signer.address));
      if (!ledger) return 0;
      const bal =
        typeof ledger.balance === "bigint"
          ? Number(ledger.balance)
          : Number(ledger.balance ?? 0);
      return Number.isFinite(bal) ? bal : 0;
    } catch {
      return 0;
    }
  }

  async listServices(): Promise<ServiceRecord[]> {
    try {
      const list = await this.broker?.inference?.listService?.();
      if (Array.isArray(list)) return list as ServiceRecord[];
    } catch {}
    try {
      const list = await this.broker?.listService?.();
      if (Array.isArray(list)) return list as ServiceRecord[];
    } catch {}
    return [];
  }

  private async resolveService(providerAddress: string): Promise<{ endpoint: string; model: string; service: ServiceRecord } | null> {
    const services = await this.listServices();
    if (!services.length) return null;
    const lower = (s: string) => s?.toLowerCase?.() ?? s;
    const svc = services.find(s => lower(s.provider) === lower(providerAddress));
    if (!svc) return null;

    let endpoint = "";
    let model = "";

    try {
      const meta = await this.broker?.inference?.getServiceMetadata?.(providerAddress);
      if (meta?.endpoint) endpoint = String(meta.endpoint);
      if (meta?.model) model = String(meta.model);
    } catch {}

    if (!endpoint) endpoint = String((svc as any).endpoint || (svc as any).url || "");
    if (!model) model = String((svc as any).model || "");

    endpoint = endpoint.trim();
    if (!endpoint) return null;

    return { endpoint, model, service: svc };
  }

  private normalizeChatURL(endpoint: string): string {
    const base = endpoint.replace(/\/+$/, "");
    return `${base}/chat/completions`;
  }

  private async safeText(res: Response): Promise<string> {
    try { return await res.text(); } catch { return ""; }
  }

  async infer(req: InferenceRequest): Promise<{ raw: ChatCompletion; verified: boolean | null }> {
    const resolved = await this.resolveService(req.providerAddress);
    if (!resolved) throw new Error("Provider not found in service catalog");
    const { endpoint, service } = resolved;

    const model = (req.modelHint || resolved.model || "").trim();
    if (!model) throw new Error("Provider did not advertise a model; pass `modelHint`");

    await this.broker.inference.acknowledgeProviderSigner(req.providerAddress);

    const headers = await this.broker.inference.getRequestHeaders(
      req.providerAddress,
      req.content
    );

    const url = this.normalizeChatURL(endpoint);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({
        messages: [{ role: "user", content: req.content }],
        model
      })
    });

    if (!res.ok) {
      const body = await this.safeText(res);
      throw new Error(`Provider HTTP ${res.status} at ${url}: ${body || "no body"}`);
    }

    const json = (await res.json()) as ChatCompletion;

    let verified: boolean | null = null;
    try {
      const chatId = json?.id;
      const content = json?.choices?.[0]?.message?.content ?? "";
      if (chatId && content && this.broker?.inference?.processResponse && service?.verifiability) {
        verified = await this.broker.inference.processResponse(req.providerAddress, content, chatId as any);
      }
    } catch {
      verified = null;
    }

    return { raw: json, verified };
  }
}
