import { getAccessSettings, saveAccessSettings } from "../../../db/store";

export const dynamic = "force-dynamic";

export async function GET() {
  try { return Response.json(await getAccessSettings()); }
  catch { return Response.json({ error: "Could not load exclusive group sets." }, { status: 500 }); }
}

export async function PATCH(request: Request) {
  let body: { exclusiveGroupSets?: unknown } | null;
  try { body = await request.json() as typeof body; }
  catch { return Response.json({ error: "Expected a JSON body." }, { status: 400 }); }
  try { return Response.json(await saveAccessSettings(body?.exclusiveGroupSets)); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Could not save exclusive group sets." }, { status: 400 }); }
}
