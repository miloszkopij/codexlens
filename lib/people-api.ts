import type { Entity } from "../app/types";
import { fetchJson } from "./http";

export interface PeopleProfile {
  id?: string; personNumber?: string | number; displayName?: string; email?: string; title?: string;
  department?: string; rootDepartment?: string;
  manager?: { id?: string; displayName?: string; email?: string; account?: string };
  company?: string; isActive?: boolean; accountStatus?: string;
}

function candidates(payload: unknown): PeopleProfile[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const object = payload as Record<string, unknown>;
  for (const key of ["data", "items", "people"]) if (Array.isArray(object[key])) return object[key] as PeopleProfile[];
  return [];
}

export async function findPersonByEmail(baseUrl: string, email: string) {
  const payload = await fetchJson<unknown>(`${baseUrl}/api/people?email=${encodeURIComponent(email)}`, { headers: { Accept: "application/json" } }, 3);
  const matches = candidates(payload);
  const exact = matches.filter((person) => String(person.email ?? "").toLowerCase() === email.toLowerCase());
  if (exact.length >= 1) return { profile: exact[0], match: exact.length === 1 ? "Matched" as const : "Ambiguous" as const };
  if (matches.length === 1) return { profile: matches[0], match: "Matched" as const };
  return { profile: null, match: matches.length > 1 ? "Ambiguous" as const : "Missing" as const };
}

function normalizedName(value?: string | null) {
  return String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export async function findPersonByDisplayName(baseUrl: string, displayName: string) {
  const payload = await fetchJson<unknown>(`${baseUrl}/api/people?displayName=${encodeURIComponent(displayName)}`, { headers: { Accept: "application/json" } }, 3);
  const matches = candidates(payload);
  const exact = matches.filter((person) => normalizedName(person.displayName) === normalizedName(displayName));
  if (exact.length >= 1) return { profile: exact[0], match: exact.length === 1 ? "Matched" as const : "Ambiguous" as const };
  if (matches.length === 1) return { profile: matches[0], match: "Matched" as const };
  return { profile: null, match: matches.length > 1 ? "Ambiguous" as const : "Missing" as const };
}

export async function listEmployees(baseUrl: string, personId: string) {
  const payload = await fetchJson<unknown>(`${baseUrl}/api/people/${encodeURIComponent(personId)}/employees`, { headers: { Accept: "application/json" } }, 3);
  return candidates(payload);
}

export function entityFromCompany(company?: string | null, email?: string | null): Entity {
  const value = `${company ?? ""} ${email ?? ""}`.toLowerCase();
  if (value.includes("ebilet") || value.includes("e-bilet")) return "eBilet";
  if (value.includes("ceneo")) return "Ceneo";
  if (value.includes("allegro")) return "Allegro";
  return "Unknown";
}
