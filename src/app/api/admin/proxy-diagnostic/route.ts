import { requireOwnerSession } from "@/lib/admin-guard";
import { clientIp } from "@/lib/rate-limit";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    await requireOwnerSession();
  } catch {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  return Response.json(
    {
      trustedProxyHops: Number(process.env.TRUSTED_PROXY_HOPS || 1),
      forwardedHopCount:
        request.headers
          .get("x-forwarded-for")
          ?.split(",")
          .filter((hop) => hop.trim()).length ?? 0,
      selectedClientIp: clientIp(request.headers),
    },
    { headers: { "cache-control": "no-store" } }
  );
}
