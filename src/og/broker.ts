import { Wallet, JsonRpcProvider } from "ethers";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createZGComputeNetworkBroker } = require("@0glabs/0g-serving-broker");

export type InferenceRequest = {
  providerAddress: string;
  content: string;
  modelHint?: string; // optional fallback, but we prefer provider model
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
      const b =
        (await this.broker?.ledger?.getBalance?.()) ??
        (await this.broker?.ledger?.getBalance?.(this.signer.address));
      if (typeof b === "number") return b;
      if (b && typeof b.balance === "number") return b.balance;
      if (b && typeof b.balance === "bigint") return Number(b.balance);
    } catch {}
    return 0;
  }

  async addLedger(initialA0GI: number): Promise<void> {
    await this.broker?.ledger?.addLedger?.(initialA0GI);
  }

  async depositFund(amountA0GI: number): Promise<void> {
    await this.broker?.ledger?.depositFund?.(amountA0GI);
  }

  async listServices(): Promise<any[]> {
    try {
      const root = await this.broker?.listService?.();
      if (Array.isArray(root)) return root;
    } catch {}
    try {
      const inf = await this.broker?.inference?.listService?.();
      if (Array.isArray(inf)) return inf;
    } catch {}
    return [];
  }

  async getServiceMetadata(
    providerAddress: string
  ): Promise<{ endpoint?: string; model?: string } | null> {
    try {
      const m = await this.broker?.getServiceMetadata?.(providerAddress);
      if (m && (m.endpoint || m.model)) return m;
    } catch {}
    try {
      const m2 = await this.broker?.inference?.getServiceMetadata?.(providerAddress);
      if (m2 && (m2.endpoint || m2.model)) return m2;
    } catch {}

    const services = await this.listServices();
    if (!services.length) return null;
    const lower = (x: string) => (typeof x === "string" ? x.toLowerCase() : "");
    const svc =
      services.find((s: any) => lower(s?.provider) === lower(providerAddress)) ??
      services[0];
    const endpoint = (svc as any)?.url ?? (svc as any)?.endpoint ?? "";
    const model = (svc as any)?.model ?? "";
    return { endpoint, model };
  }

  async infer(
    req: InferenceRequest
  ): Promise<{ raw: ChatCompletion; verified: boolean | null }> {
    const meta = await this.getServiceMetadata(req.providerAddress);
    if (!meta?.endpoint) {
      throw new Error("No 0G service endpoint for the provider");
    }

    // Must call once per provider; SDK is idempotent
    await this.broker.inference.acknowledgeProviderSigner(req.providerAddress);

    // Single-use headers – generate fresh per request (cannot be reused)
    const headers = await this.broker.inference.getRequestHeaders(
      req.providerAddress,
      req.content
    );

    const url = `${meta.endpoint.replace(/\/+$/, "")}/chat/completions`;
    // Prefer provider-advertised model; fallback to hint only if absent
    const model = meta.model ?? req.modelHint;
    if (!model) throw new Error("Provider did not advertise a model; pass modelHint");

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Some proxies expect Authorization header present; harmless if empty
        Authorization: (headers as any).Authorization ?? "Bearer ",
        ...headers
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: req.content }],
        model
      })
    });

    if (!res.ok) {
      const body = await this.safeText(res);
      // 403 => header reuse or insufficient balance; 404 => bad model/path
      throw new Error(`Provider HTTP ${res.status} at ${url}: ${body || "no body"}`);
    }

    const json = (await res.json()) as ChatCompletion;

    let verified: boolean | null = null;
    try {
      const chatId = json?.id;
      const content = json?.choices?.[0]?.message?.content ?? "";
      if (chatId && content && this.broker?.inference?.processResponse) {
        verified = await this.broker.inference.processResponse(
          req.providerAddress,
          content,
          chatId as any
        );
      }
    } catch {
      verified = null;
    }

    return { raw: json, verified };
  }

  private async safeText(res: Response): Promise<string> {
    try {
      return await res.text();
    } catch {
      return "";
    }
  }
}
