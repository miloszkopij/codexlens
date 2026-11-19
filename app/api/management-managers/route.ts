import type { ManagementManagerOption } from "../../types";
import { getWorkspaceConfig } from "../../../lib/config";
import { findPersonByDisplayName, profileId, searchPeople, type PeopleProfile } from "../../../lib/people-api";

export const dynamic = "force-dynamic";

function optionFromProfile(profile: PeopleProfile): ManagementManagerOption | null {
  const id = profileId(profile);
  const name = String(profile.displayName ?? "").trim();
  if (!id || !name) return null;
  return {
    id,
    name,
    email: profile.email?.trim() || null,
    title: profile.title?.trim() || null,
    department: profile.department?.trim() || profile.rootDepartment?.trim() || null,
  };
}

function deduplicate(options: Array<ManagementManagerOption | null>) {
  const seen = new Set<string>();
  return options.filter((option): option is ManagementManagerOption => {
    if (!option || seen.has(option.id)) return false;
    seen.add(option.id);
    return true;
  }).sort((a, b) => a.name.localeCompare(b.name) || (a.email ?? "").localeCompare(b.email ?? ""));
}

export async function GET(request: Request) {
  try {
    const config = getWorkspaceConfig();
    const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
    if (query.length > 80) return Response.json({ error: "Manager search is limited to 80 characters." }, { status: 400 });
    if (query && query.length < 2) return Response.json({ error: "Enter at least 2 characters to search managers." }, { status: 400 });

    if (!query) {
      const result = await findPersonByDisplayName(config.peopleBaseUrl, config.managementLeaderName);
      const defaultManager = result.profile && result.match === "Matched" ? optionFromProfile(result.profile) : null;
      if (!defaultManager) return Response.json({ error: `${config.managementLeaderName} could not be matched uniquely in People API.` }, { status: 404 });
      return Response.json({ defaultManager, managers: [defaultManager], truncated: false });
    }

    const profiles = await searchPeople(config.peopleBaseUrl, query);
    const managers = deduplicate(profiles.map(optionFromProfile)).slice(0, 20);
    return Response.json({ managers, truncated: profiles.length > managers.length });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Manager search could not be completed." }, { status: 502 });
  }
}
