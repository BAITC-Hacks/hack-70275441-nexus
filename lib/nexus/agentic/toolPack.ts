import type { ToolContext, ToolResult } from "./types";

export type ToolArgumentKind = "none" | "column" | "pair";
export type NexusToolDefinition = {
  name: string;
  description: string;
  argumentKind: ToolArgumentKind;
  allowedAgents: Array<"INVESTIGATOR" | "SKEPTIC">;
  execute: (context: ToolContext, args: Record<string, string>) => ToolResult;
};

export function validToolArguments(tool: NexusToolDefinition, columns: string[], args: Record<string, string>) {
  if (tool.argumentKind === "none") return Object.keys(args).length === 0;
  if (tool.argumentKind === "column") return columns.includes(args.column);
  return columns.includes(args.left) && columns.includes(args.right) && args.left !== args.right;
}
