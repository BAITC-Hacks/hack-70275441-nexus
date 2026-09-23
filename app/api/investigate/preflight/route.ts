import { analyticalTools } from "@/lib/nexus/agentic/toolRegistry";
import { MAX_LLM_CALLS, MAX_TOOL_CALLS } from "@/lib/nexus/agentic/types";
import { syntheticIndustrialDataset } from "@/lib/nexus/demo/syntheticIndustrial";

export const dynamic = "force-dynamic";

export async function GET() {
  const dataset = syntheticIndustrialDataset();
  return Response.json({
    datasetAvailable: dataset.rows.length > 0,
    liveAgentsAvailable: Boolean(process.env.OPENAI_API_KEY),
    toolRegistryInitialized: Object.keys(analyticalTools).length > 0,
    llmBudget: MAX_LLM_CALLS,
    toolBudget: MAX_TOOL_CALLS,
  });
}
