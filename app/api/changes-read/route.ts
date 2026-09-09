import { markAllChangesRead } from "../../../db/store";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    await markAllChangesRead();
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not mark changes as read." }, { status: 500 });
  }
}
