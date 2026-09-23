import { handleReplenishmentNarrationPost } from "../../../../lib/nexus/replenishment/narration.ts";

export async function POST(request: Request) {
  return handleReplenishmentNarrationPost(request);
}
