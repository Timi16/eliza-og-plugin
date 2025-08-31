import { Wallet, JsonRpcProvider } from "ethers";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createZGComputeNetworkBroker } = require("@0glabs/0g-serving-broker");

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type InferenceRequest = {
  providerAddress: string;
  messages: ChatMessage[];
  modelHint?: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
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

  private pickService(services: any[], providerAddress: string) {
    const lower = (s: string) => (typeof s === "string" ? s.toLowerCase() : "");
    const owned = services.filter(s => lower(s?.provider) === lower(providerAddress));
    const pool = owned.length ? owned : services;
    const byType =
      pool.find(s => /inference|chat/i.test(String(s?.serviceType || ""))) ??
      pool[0];
    return byType || null;
  }

  async getServiceMetadata(providerAddress: string): Promise<{ endpoint?: string; model?: string } | null> {
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
    const svc = this.pickService(services, providerAddress);
    if (!svc) return null;
    const endpoint = (svc as any)?.url ?? (svc as any)?.endpoint ?? "";
    const model = (svc as any)?.model ?? "";
    return { endpoint, model };
  }

  private latestUserText(messages: ChatMessage[]): string {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user" && messages[i].content) return messages[i].content;
    }
    return messages.map(m => `[${m.role}] ${m.content}`).join("\n");
  }

  private buildBody(req: InferenceRequest, model: string) {
    const body: Record<string, unknown> = { model, messages: req.messages };
    if (typeof req.temperature === "number") body.temperature = req.temperature;
    if (typeof req.topP === "number") body.top_p = req.topP;
    if (typeof req.maxTokens === "number") body.max_tokens = req.maxTokens;
    return body;
  }

  private chatPaths(base: string): string[] {
    const b = base.replace(/\/+$/, "");
    if (/\/chat\/completions$/.test(b)) return [b];
    const out = new Set<string>();
    out.add(`${b}/chat/completions`);
    out.add(`${b}/v1/chat/completions`);
    return Array.from(out);
  }

  private async postFirstOk(
    base: string,
    headers: Record<string, string>,
    body: unknown
  ): Promise<{ json: ChatCompletion; url: string }> {
    const paths = this.chatPaths(base);
    let lastNon404 = "";
    for (const url of paths) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body)
      });
      if (res.ok) return { json: (await res.json()) as ChatCompletion, url };
      if (res.status !== 404) {
        const txt = await this.safeText(res);
        lastNon404 = `Provider HTTP ${res.status} at ${url}: ${txt || "no body"}`;
        break;
      }
    }
    if (lastNon404) throw new Error(lastNon404);
    throw new Error(`Provider HTTP 404: no working chat endpoint under base ${base}`);
  }

  private async reinit() {
    this.broker = await createZGComputeNetworkBroker(this.signer);
  }

  async infer(req: InferenceRequest): Promise<{ raw: ChatCompletion; verified: boolean | null }> {
    const meta = await this.getServiceMetadata(req.providerAddress);
    if (!meta?.endpoint) throw new Error("No 0G service endpoint for the provider");

    const billable = this.latestUserText(req.messages);
    await this.broker.inference.acknowledgeProviderSigner(req.providerAddress);

    const getHeaders = async () => {
      return await this.broker.inference.getRequestHeaders(req.providerAddress, billable);
    };

    let headers: Record<string, string>;
    try {
      headers = await getHeaders();
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (/Unknown service type/i.test(msg)) {
        await this.reinit();
        await this.broker.inference.acknowledgeProviderSigner(req.providerAddress);
        headers = await getHeaders();
      } else {
        throw e;
      }
    }

    const model = meta.model ?? req.modelHint;
    if (!model) throw new Error("Provider did not advertise a model; pass modelHint");

    const body = this.buildBody(req, model);
    const { json } = await this.postFirstOk(meta.endpoint, headers, body);

    let verified: boolean | null = null;
    try {
      const id = json?.id;
      const content = json?.choices?.[0]?.message?.content ?? "";
      if (id && content && this.broker?.inference?.processResponse) {
        verified = await this.broker.inference.processResponse(req.providerAddress, content, id as any);
      }
    } catch {
      verified = null;
    }

    return { raw: json, verified };
  }

  private async safeText(res: Response): Promise<string> {
    try { return await res.text(); } catch { return ""; }
  }
}
