export function normalizeOgChatResult(json: any) {
  const content = json?.choices?.[0]?.message?.content ?? "";
  const usage = json?.usage ?? null;
  const id = json?.id ?? null;
  return { id, content, usage, raw: json };
}
