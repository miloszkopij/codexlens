import { getChanges } from "../../../db/store";
import { parseChangeQuery } from "../../../lib/change-filters";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  let filters;
  try { filters = parseChangeQuery(new URL(request.url).searchParams); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Invalid change filters." }, { status: 400 }); }
  try { return Response.json(await getChanges(filters)); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Could not load change history." }, { status: 500 }); }
}
