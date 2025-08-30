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
  private cache: Map<
    string,
    { endpoint: string; model?: string }
  > = new Map();

  constructor(privateKey: string, rpcUrl: string) {
    const provider = new JsonRpcProvider(rpcUrl);
    this.signer = new Wallet(privateKey, provider);
  }

  async init() {
    this.broker = await createZGComputeNetworkBroker(this.signer);
    // Warm inference service map so getRequestHeaders won’t lack serviceType
    await this.safeListServices();
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
    return this.safeListServices();
  }

  private async safeListServices(): Promise<any[]> {
    // Try inference list first (it populates the inference broker’s internal lookup)
    try {
      const inf = await this.broker?.inference?.listService?.();
      if (Array.isArray(inf)) return inf;
    } catch {}
    // Fallback to root list
    try {
      const root = await this.broker?.listService?.();
      if (Array.isArray(root)) return root;
    } catch {}
    return [];
  }

  private async ensureInferenceMeta(
    providerAddress: string
  ): Promise<{ endpoint: string; model?: string }> {
    const key = providerAddress.toLowerCase();
    // Use cache if present
    const cached = this.cache.get(key);
    if (cached?.endpoint) return cached;

    // Ask the INFERENCE module first — this populates its serviceType map
    try {
      const m =
        (await this.broker?.inference?.getServiceMetadata?.(providerAddress)) ||
        null;
      if (m?.endpoint) {
        const meta = { endpoint: m.endpoint as string, model: (m as any).model };
        this.cache.set(key, meta);
        return meta;
      }
    } catch {}

    // If not returned, force-refresh service list and pick the matching provider
    const services = await this.safeListServices();
    if (!services.length) {
      throw new Error(
        "No 0G services visible on this RPC. Use Galileo (chain 16601) or check provider registration."
      );
    }
    const svc =
      services.find(
        (s: any) =>
          String(s?.provider || "").toLowerCase() === key
      ) ?? services[0];

    const endpoint = (svc as any)?.url ?? (svc as any)?.endpoint ?? "";
    const model = (svc as any)?.model ?? undefined;
    if (!endpoint) {
      throw new Error(
        "Provider has no endpoint registered; cannot perform inference."
      );
    }
    const meta = { endpoint: String(endpoint), model: model ? String(model) : undefined };
    this.cache.set(key, meta);
    return meta;
  }

  async infer(
    req: InferenceRequest
  ): Promise<{ raw: ChatCompletion; verified: boolean | null }> {
    const meta = await this.ensureInferenceMeta(req.providerAddress);
    if (!meta.endpoint) {
      throw new Error("No 0G service endpoint for the provider");
    }

    // Acknowledge is idempotent; keeps provider-side state happy across calls
    await this.broker.inference.acknowledgeProviderSigner(req.providerAddress);

    // IMPORTANT: get new, single-use billing headers each request
    // Calling after ensureInferenceMeta() guarantees inference serviceType is known
    const headers = await this.broker.inference.getRequestHeaders(
      req.providerAddress,
      req.content
    );

    const url = joinPath(meta.endpoint, "chat/completions");
    const model = req.modelHint ?? meta.model;
    if (!model) {
      throw new Error(
        "Provider did not advertise a model; pass `modelHint` in the request."
      );
    }

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Some proxies require Authorization to exist; harmless otherwise
        Authorization: (headers as any).Authorization ?? "Bearer ",
        ...headers,
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: req.content }],
        model,
      }),
    });

    if (!res.ok) {
      const body = await this.safeText(res);
      throw new Error(`Provider HTTP ${res.status} at ${url}: ${body || "no body"}`);
    }

    const json = (await res.json()) as ChatCompletion;

    // Optional verification (TEE-backed services)
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

function joinPath(base: string, tail: string): string {
  const b = (base || "").trim().replace(/\/+$/, "");
  const t = tail.replace(/^\/+/, "");
  return `${b}/${t}`;
}
