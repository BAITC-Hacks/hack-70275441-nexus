export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(
    { status: "ok", service: "nexus-electrokomplekt" },
    { status: 200, headers: { "cache-control": "no-store" } },
  );
}
