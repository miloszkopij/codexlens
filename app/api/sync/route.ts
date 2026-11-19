import { runDirectorySync } from "../../../lib/directory-sync";
import { requireSameOrigin } from "../../../lib/request-safety";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const mode = new URL(request.url).searchParams.get("usage");
    return Response.json(await runDirectorySync(mode === "none" ? "none" : mode === "incremental" ? "incremental" : "full"));
  } catch (error) { return Response.json({ error: (error as Error).message }, { status: 500 }); }
}
