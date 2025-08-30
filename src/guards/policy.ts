import type { AgentConfig } from "../config/schema.ts";

export function assertWithinBudget(
  config: AgentConfig["agent"],
  estimatedCostA0GI: number
) {
  if (estimatedCostA0GI > config.budget.perCallA0GI) {
    throw new Error(
      `Per-call budget exceeded: ${estimatedCostA0GI} > ${config.budget.perCallA0GI}`
    );
  }
}
