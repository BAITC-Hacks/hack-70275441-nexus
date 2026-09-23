import { redirect } from "next/navigation";

// This case's actual solution lives at /replenishment. The generic harness landing page
// (CommandCenter, /investigate) remains reachable directly by URL as disclosed pre-existing
// infrastructure, but is no longer what a visitor sees by default.
export default function Home() {
  redirect("/replenishment");
}
