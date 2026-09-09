import type { AnalyticsBucket, Entity } from "../../types";
import { getAnalytics } from "../../../db/store";

export const dynamic = "force-dynamic";

function validDate(value: string | null) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()) ? value : null;
}

function defaultRange() {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 29);
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const fallback = defaultRange();
    const startDate = validDate(url.searchParams.get("start")) ?? fallback.startDate;
    const endDate = validDate(url.searchParams.get("end")) ?? fallback.endDate;
    if (startDate > endDate) return Response.json({ error: "Start date must not be after end date." }, { status: 400 });
    const bucketValue = url.searchParams.get("bucket");
    const bucket: AnalyticsBucket = bucketValue === "day" || bucketValue === "week" || bucketValue === "month" ? bucketValue : "day";
    const entityValue = url.searchParams.get("entity");
    const entity: Entity | null = entityValue === "Allegro" || entityValue === "eBilet" || entityValue === "Ceneo" || entityValue === "Unknown" ? entityValue : null;
    const groupId = url.searchParams.get("group") || null;
    return Response.json(await getAnalytics({ startDate, endDate, bucket, entity, groupId }));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not load analytics." }, { status: 500 });
  }
}
