import { z } from "zod";

export const AgentConfigSchema = z.object({
  agent: z.object({
    model: z.string().default(""),
    budget: z.object({
      perCallA0GI: z.number().nonnegative().default(0.01),
      dailyA0GI: z.number().nonnegative().default(0.5),
      lowBalanceA0GI: z.number().nonnegative().default(0.02)
    }),
    generation: z.object({
      maxTokens: z.number().int().positive().default(512),
      temperature: z.number().min(0).max(2).default(0.7),
      topP: z.number().min(0).max(1).default(1)
    }).partial(),
    tools: z.array(z.string()).default(["og.infer"]),
    routing: z.object({
      alwaysUse0G: z.boolean().default(true)
    }).partial(),
    postActions: z.array(z.string()).default([])
  })
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;
