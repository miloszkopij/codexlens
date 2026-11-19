import type { Entity } from "../app/types";
import { fetchJson } from "./http";

export interface PeopleProfile {
  id?: string; personNumber?: string | number; displayName?: string; email?: string; title?: string; account?: string;
  department?: string; rootDepartment?: string;
  manager?: { id?: string; displayName?: string; email?: string; account?: string };
  company?: string; isActive?: boolean; accountStatus?: string;
}

export function profileId(profile?: { id?: string; personNumber?: string | number } | null) {
  const id = profile?.id ?? profile?.personNumber;
  return id === undefined || id === null || String(id).trim() === "" ? null : String(id);
}

const directoryCache = new Map<string, { expiresAt: number; retrievedAt: string; people: PeopleProfile[] }>();
const DIRECTORY_CACHE_MS = 10 * 60 * 1000;
const DIRECTORY_CACHE_MAX_ENTRIES = 2;

function candidates(payload: unknown): PeopleProfile[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  const object = payload as Record<string, unknown>;
  for (const key of ["data", "items", "people"]) if (Array.isArray(object[key])) return object[key] as PeopleProfile[];
  return [];
}

function singleProfile(payload: unknown): PeopleProfile | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const object = payload as Record<string, unknown>;
  for (const key of ["data", "person", "profile"]) {
    const value = object[key];
    if (value && typeof value === "object" && !Array.isArray(value)) return value as PeopleProfile;
  }
  return ("id" in object || "personNumber" in object || "displayName" in object) ? object as PeopleProfile : null;
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
  return String(value ?? "").normalize("NFKD").replace(/[łŁ]/g, (letter) => letter === "Ł" ? "L" : "l").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function editDistance(left: string, right: string) {
  const distances = Array.from({ length: left.length + 1 }, (_, row) => Array.from({ length: right.length + 1 }, (_, column) => row === 0 ? column : column === 0 ? row : 0));
  for (let row = 1; row <= left.length; row += 1) {
    for (let column = 1; column <= right.length; column += 1) {
      distances[row][column] = Math.min(
        distances[row - 1][column] + 1,
        distances[row][column - 1] + 1,
        distances[row - 1][column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
      if (row > 1 && column > 1 && left[row - 1] === right[column - 2] && left[row - 2] === right[column - 1]) {
        distances[row][column] = Math.min(distances[row][column], distances[row - 2][column - 2] + 1);
      }
    }
  }
  return distances[left.length][right.length];
}

function tokenScore(query: string, candidate: string) {
  if (query === candidate) return 0;
  if (candidate.startsWith(query) || candidate.includes(query) || query.startsWith(candidate)) return 0.25;
  const distance = editDistance(query, candidate);
  const allowedDistance = Math.max(1, Math.floor(query.length * 0.2));
  return distance <= allowedDistance ? 0.5 + distance : Number.POSITIVE_INFINITY;
}

function profileSearchScore(profile: PeopleProfile, query: string) {
  const queryTokens = normalizedName(query).split(" ").filter(Boolean);
  if (!queryTokens.length) return null;
  const searchText = normalizedName([profile.displayName, profile.email, profile.account].filter(Boolean).join(" "));
  const candidateTokens = searchText.split(" ").filter(Boolean);
  const scores = queryTokens.map((queryToken) => Math.min(...candidateTokens.map((candidateToken) => tokenScore(queryToken, candidateToken))));
  if (scores.some((score) => !Number.isFinite(score))) return null;
  return scores.reduce((sum, score) => sum + score, 0) + Math.max(0, candidateTokens.length - queryTokens.length) * 0.02;
}

export async function listDirectoryPeople(baseUrl: string, options: { fresh?: boolean } = {}) {
  const key = baseUrl.replace(/\/+$/, "");
  const cached = directoryCache.get(key);
  if (!options.fresh && cached && cached.expiresAt > Date.now()) return cached.people;
  const payload = await fetchJson<unknown>(`${key}/api/people`, { headers: { Accept: "application/json" } }, 3);
  if (!Array.isArray(payload)) throw new Error("People API did not return a complete directory array. Coverage cannot be calculated from an unverified partial directory.");
  const people = candidates(payload);
  directoryCache.set(key, { expiresAt: Date.now() + DIRECTORY_CACHE_MS, retrievedAt: new Date().toISOString(), people });
  while (directoryCache.size > DIRECTORY_CACHE_MAX_ENTRIES) {
    const oldestKey = directoryCache.keys().next().value;
    if (!oldestKey) break;
    directoryCache.delete(oldestKey);
  }
  return people;
}

export async function getDirectorySnapshot(baseUrl: string, options: { fresh?: boolean } = {}) {
  const people = await listDirectoryPeople(baseUrl, options);
  return { people, retrievedAt: directoryCache.get(baseUrl.replace(/\/+$/, ""))?.retrievedAt ?? new Date().toISOString() };
}

export async function findPersonByDisplayName(baseUrl: string, displayName: string) {
  const payload = await fetchJson<unknown>(`${baseUrl}/api/people?displayName=${encodeURIComponent(displayName)}`, { headers: { Accept: "application/json" } }, 3);
  const matches = candidates(payload);
  const exact = matches.filter((person) => normalizedName(person.displayName) === normalizedName(displayName));
  if (exact.length >= 1) return { profile: exact[0], match: exact.length === 1 ? "Matched" as const : "Ambiguous" as const };
  if (matches.length === 1) return { profile: matches[0], match: "Matched" as const };
  return { profile: null, match: matches.length > 1 ? "Ambiguous" as const : "Missing" as const };
}

export async function findPersonById(baseUrl: string, id: string) {
  const payload = await fetchJson<unknown>(`${baseUrl}/api/people/${encodeURIComponent(id)}`, { headers: { Accept: "application/json" } }, 3);
  const profile = singleProfile(payload);
  return profile && profileId(profile) === id ? profile : profile ? { ...profile, id } : null;
}

export async function searchPeople(baseUrl: string, query: string) {
  const filter = query.includes("@") ? "email" : "displayName";
  const payload = await fetchJson<unknown>(`${baseUrl}/api/people?${filter}=${encodeURIComponent(query)}`, { headers: { Accept: "application/json" } }, 3);
  const exactMatches = candidates(payload);
  if (exactMatches.length) return exactMatches;
  const people = await listDirectoryPeople(baseUrl);
  return people
    .map((profile) => ({ profile, score: profileSearchScore(profile, query) }))
    .filter((entry): entry is { profile: PeopleProfile; score: number } => entry.score !== null)
    .sort((left, right) => left.score - right.score || String(left.profile.displayName ?? "").localeCompare(String(right.profile.displayName ?? "")))
    .slice(0, 100)
    .map((entry) => entry.profile);
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
