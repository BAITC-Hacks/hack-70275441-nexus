import { analyticalTools } from "./toolRegistry.ts";
import type { NexusToolDefinition } from "./toolPack";

export const genericPack: NexusToolDefinition[] = Object.entries(analyticalTools).map(([name, tool]) => ({
  name,
  description: tool.description,
  argumentKind: name === "calculate_correlation" ? "pair" : name === "profile_dataset" ? "none" : "column",
  allowedAgents: name === "profile_dataset" ? [] : name === "inspect_series" || name === "calculate_correlation" ? ["INVESTIGATOR"] : ["INVESTIGATOR", "SKEPTIC"],
  execute: (context, args) => tool.execute(context, args),
}));

export function resolveToolPack(scenario: "generic") {
  return genericPack;
}
