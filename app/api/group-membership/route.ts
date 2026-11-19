// Legacy writes are intentionally closed: every membership change now requires
// a server-stored, single-use preview through /api/access-plan.
export const dynamic = "force-dynamic";
export async function POST() {
  return Response.json({ error: "Use Members & groups to review a membership plan before applying changes." }, { status: 410 });
}
