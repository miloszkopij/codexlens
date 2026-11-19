import type { DashboardData, ManagementCostData, ManagementManagerOption, Member, WorkspaceGroup } from "./types";

export const demoMembers: Member[] = [
  { id: "demo-1", name: "Maya Nowak", email: "maya.nowak@example.com", workspaceRole: "Admin", peopleRole: "Senior Product Manager", department: "Customer Experience", manager: "Ola Zielińska", entity: "Allegro", groups: ["PM", "GenAI Champions", "admin", "cat-team"], usage: 1840, messages: 512, status: "Active", peopleMatch: "Matched" },
  { id: "demo-2", name: "Leo Kowalski", email: "leo.kowalski@example.com", workspaceRole: "Member", peopleRole: "Senior Software Engineer", department: "Technology", manager: "Adam Lis", entity: "Allegro", groups: ["Developers"], usage: 1620, messages: 438, status: "Active", peopleMatch: "Matched" },
  { id: "demo-3", name: "Nina Wiśniewska", email: "nina.wisniewska@example.com", workspaceRole: "Member", peopleRole: "UX Researcher", department: "Design", manager: "Maya Nowak", entity: "Ceneo", groups: ["PM"], usage: 1395, messages: 326, status: "Active", peopleMatch: "Matched" },
  { id: "demo-4", name: "Jakub Mazur", email: "jakub.mazur@example.com", workspaceRole: "Member", peopleRole: "Machine Learning Engineer", department: "Data & AI", manager: "Leo Kowalski", entity: "Allegro", groups: ["Developers", "GenAI Champions"], usage: 1240, messages: 291, status: "Active", peopleMatch: "Matched" },
  { id: "demo-5", name: "Zofia Kaczmarek", email: "zofia.kaczmarek@example.com", workspaceRole: "Member", peopleRole: "Security Engineer", department: "Cybersecurity", manager: "Marek Wrona", entity: "Allegro", groups: ["SEC"], usage: 930, messages: 217, status: "Active", peopleMatch: "Matched" },
  { id: "demo-6", name: "Antoni Wójcik", email: "antoni.wojcik@example.com", workspaceRole: "Member", peopleRole: "Program Manager", department: "Operations", manager: "Maya Nowak", entity: "eBilet", groups: ["PM"], usage: 885, messages: 192, status: "Active", peopleMatch: "Matched" },
  { id: "demo-7", name: "Lena Król", email: "lena.krol@example.com", workspaceRole: "Member", peopleRole: "Fraud Analyst", department: "Trust & Safety", manager: "Kamil Dudek", entity: "Allegro", groups: ["white-collar"], usage: 740, messages: 164, status: "Active", peopleMatch: "Matched" },
  { id: "demo-8", name: "Filip Pawlak", email: "filip.pawlak@example.com", workspaceRole: "Member", peopleRole: "Data Analyst", department: "Analytics", manager: "Jakub Mazur", entity: "Ceneo", groups: ["Developers"], usage: 695, messages: 138, status: "Active", peopleMatch: "Matched" },
  { id: "demo-9", name: "Julia Michalska", email: "julia.michalska@example.com", workspaceRole: "Member", peopleRole: "Compliance Expert", department: "Legal", manager: "Lena Król", entity: "Allegro", groups: ["white-collar"], usage: 604, messages: 121, status: "Active", peopleMatch: "Matched" },
  { id: "demo-10", name: "Oskar Zalewski", email: "oskar.zalewski@example.com", workspaceRole: "Member", peopleRole: "Project Manager", department: "Live Events", manager: "Antoni Wójcik", entity: "eBilet", groups: ["PM"], usage: 482, messages: 97, status: "Active", peopleMatch: "Matched" },
  { id: "demo-11", name: "Sara Szymańska", email: "sara.szymanska@example.com", workspaceRole: "Member", peopleRole: null, department: null, manager: null, entity: "Unknown", groups: [], usage: 0, messages: 0, status: "Invited", peopleMatch: "Missing" },
  { id: "demo-12", name: "Tomasz Woźniak", email: "tomasz.wozniak@example.com", workspaceRole: "Owner", peopleRole: "Director, Technology", department: "Technology", manager: null, entity: "Allegro", groups: ["Developers", "Leaders"], usage: 1110, messages: 244, status: "Active", peopleMatch: "Matched" },
];

export const demoGroups: WorkspaceGroup[] = [
  { id: "pm", name: "PM", description: "Product, UX, research, program and project roles", memberCount: 80, usage: 31740, activeMembers: 67, source: "Manual", accent: "mint" },
  { id: "developers", name: "Developers", description: "Software, data, ML, platform and analyst roles", memberCount: 112, usage: 68420, activeMembers: 91, source: "Manual", accent: "blue" },
  { id: "white-collar", name: "white-collar", description: "Fraud, compliance and business operations", memberCount: 27, usage: 12880, activeMembers: 19, source: "Manual", accent: "violet" },
  { id: "sec", name: "SEC", description: "Security and cybersecurity roles", memberCount: 18, usage: 8940, activeMembers: 14, source: "Manual", accent: "amber" },
  { id: "leaders", name: "Leaders", description: "People managers and workspace sponsors", memberCount: 22, usage: 14510, activeMembers: 20, source: "SCIM", accent: "rose" },
  { id: "champions", name: "GenAI Champions", description: "Cross-functional enablement community", memberCount: 35, usage: 27560, activeMembers: 32, source: "Manual", accent: "slate" },
  { id: "admin", name: "admin", description: "Special membership, assigned individually; not the built-in Admin role", memberCount: 1, usage: 1840, activeMembers: 1, source: "Manual", accent: "amber" },
  { id: "cat-team", name: "cat-team", description: "Special membership, assigned individually", memberCount: 1, usage: 1840, activeMembers: 1, source: "Manual", accent: "violet" },
  { id: "ceneo", name: "Ceneo", description: "Regular group; eligible for an exact email-domain rule", memberCount: 0, usage: 0, activeMembers: 0, source: "Manual", accent: "blue" },
  { id: "ebilet", name: "eBilet", description: "Regular group; eligible for an exact email-domain rule", memberCount: 0, usage: 0, activeMembers: 0, source: "Manual", accent: "rose" },
];

export const demoData: DashboardData = {
  mode: "demo",
  workspaceName: "example-chatgpt",
  workspaceId: "demo-workspace",
  lastSyncedAt: null,
  usageSource: "Illustrative preview",
  usageUnit: "credits",
  settings: {
    pricePerCredit: 0.04,
    currency: "USD",
    currentCreditBalance: null,
    unbilledOverageCredits: null,
    workspaceOverageLimitCredits: null,
    billingBudgetAmount: null,
    budgetAlertPercent: 80,
    billingPeriodStart: null,
    billingPeriodEnd: null,
  },
  members: demoMembers,
  groups: demoGroups,
  changes: [
    { id: "c1", person: "Nina Wiśniewska", subjectId: "demo-3", action: "Entity changed", detail: "Allegro → Ceneo", time: "12 min ago", entity: "Ceneo", kind: "entity", unread: true },
    { id: "c2", person: "Jakub Mazur", subjectId: "demo-4", action: "Joined a group", detail: "GenAI Champions", time: "48 min ago", entity: "Allegro", kind: "group", unread: true },
    { id: "c3", person: "Sara Szymańska", subjectId: "demo-11", action: "People profile missing", detail: "Needs manual review before assignment", time: "2 hr ago", entity: "Unknown", kind: "member", unread: true },
    { id: "c4", person: "Antoni Wójcik", subjectId: "demo-6", action: "People API role changed", detail: "Project Manager → Program Manager", time: "Yesterday", entity: "eBilet", kind: "role", unread: true },
    { id: "c5", person: "PM", action: "Membership updated", detail: "+4 members since the last sync", time: "Yesterday", entity: "Allegro", kind: "group", unread: false },
  ],
  trend: [
    { label: "Aug 04", credits: 12800 }, { label: "Aug 08", credits: 15350 },
    { label: "Aug 12", credits: 14620 }, { label: "Aug 16", credits: 19180 },
    { label: "Aug 20", credits: 17540 }, { label: "Aug 24", credits: 22280 },
    { label: "Aug 28", credits: 20740 }, { label: "Sep 01", credits: 25840 },
  ],
};

export const demoManagementManagers: ManagementManagerOption[] = [
  { id: "demo-manager-david", name: "David Roberts", email: "david.roberts@example.com", title: "Chief Product Officer", department: "Product & Technology" },
  { id: "demo-manager-anna", name: "Anna Zielińska", email: "anna.zielinska@example.com", title: "VP, Customer Experience", department: "Customer Experience" },
  { id: "demo-manager-tomasz", name: "Tomasz Woźniak", email: "tomasz.wozniak@example.com", title: "Director, Technology", department: "Technology" },
];

const demoManagementTeams: Record<string, Array<{ id: string; name: string; title: string; department: string; memberIds: string[] }>> = {
  "demo-manager-david": [
    { id: "demo-team-maya", name: "Maya Nowak", title: "Senior Product Manager", department: "Customer Experience", memberIds: ["demo-1", "demo-3", "demo-6"] },
    { id: "demo-team-leo", name: "Leo Kowalski", title: "Senior Software Engineer", department: "Technology", memberIds: ["demo-2", "demo-4", "demo-8"] },
    { id: "demo-team-marek", name: "Marek Wrona", title: "Security Manager", department: "Cybersecurity", memberIds: ["demo-5"] },
    { id: "demo-team-kamil", name: "Kamil Dudek", title: "Trust & Safety Manager", department: "Trust & Safety", memberIds: ["demo-7", "demo-9"] },
    { id: "demo-team-antoni", name: "Antoni Wójcik", title: "Program Manager", department: "Operations", memberIds: ["demo-10"] },
  ],
  "demo-manager-anna": [
    { id: "demo-team-anna-product", name: "Customer Experience", title: "Product & design", department: "Customer Experience", memberIds: ["demo-1", "demo-3", "demo-11"] },
    { id: "demo-team-anna-tech", name: "Technology", title: "Engineering & data", department: "Technology", memberIds: ["demo-2", "demo-4", "demo-8", "demo-12"] },
    { id: "demo-team-anna-ops", name: "Operations", title: "Programs & trust", department: "Operations", memberIds: ["demo-6", "demo-7", "demo-9", "demo-10"] },
  ],
  "demo-manager-tomasz": [
    { id: "demo-team-tomasz-platform", name: "Platform leadership", title: "Technology", department: "Technology", memberIds: ["demo-2", "demo-4", "demo-8", "demo-12"] },
  ],
};

function demoUsageValue(usage: number, data: DashboardData) {
  if (data.usageUnit === "usd") return usage;
  return data.settings.pricePerCredit === null ? null : usage * data.settings.pricePerCredit;
}

export function demoManagementData(data: DashboardData, startDate: string, endDate: string, managerId: string): ManagementCostData {
  const manager = demoManagementManagers.find((candidate) => candidate.id === managerId) ?? demoManagementManagers[0];
  const membersById = new Map(data.members.map((member) => [member.id, member]));
  const workspaceUsage = data.members.reduce((sum, member) => sum + member.usage, 0);
  const selectedTeams = demoManagementTeams[manager.id] ?? [];
  const selectedMemberIds = new Set(selectedTeams.flatMap((team) => team.memberIds));
  const selectedOrgUsage = [...selectedMemberIds].reduce((sum, id) => sum + (membersById.get(id)?.usage ?? 0), 0);
  const rows: ManagementCostData["rows"] = selectedTeams.map((team) => {
    const usage = team.memberIds.reduce((sum, id) => sum + (membersById.get(id)?.usage ?? 0), 0);
    const usageValue = demoUsageValue(usage, data);
    return {
      id: team.id, name: team.name, email: null, title: team.title, department: team.department,
      memberCount: team.memberIds.filter((id) => membersById.has(id)).length,
      activeUsers: team.memberIds.filter((id) => (membersById.get(id)?.usage ?? 0) > 0).length,
      messages: team.memberIds.reduce((sum, id) => sum + (membersById.get(id)?.messages ?? 0), 0),
      usage, usageValue, selectedOrgShare: selectedOrgUsage > 0 ? usage / selectedOrgUsage : 0,
      invoiceShare: workspaceUsage > 0 ? usage / workspaceUsage : 0,
      allocatedInvoiceCost: usageValue,
      reconciliation: false,
    };
  });
  const outsideUsage = Math.max(0, workspaceUsage - selectedOrgUsage);
  const outsideValue = demoUsageValue(outsideUsage, data);
  rows.push({
    id: "__outside_selected_teams__", name: `Outside ${manager.name}'s teams / unresolved`, email: null,
    title: "Workspace reconciliation", department: null,
    memberCount: data.members.length - selectedMemberIds.size,
    activeUsers: data.members.filter((member) => !selectedMemberIds.has(member.id) && member.usage > 0).length,
    messages: data.members.filter((member) => !selectedMemberIds.has(member.id)).reduce((sum, member) => sum + member.messages, 0),
    usage: outsideUsage, usageValue: outsideValue, selectedOrgShare: 0,
    invoiceShare: workspaceUsage > 0 ? outsideUsage / workspaceUsage : 0,
    allocatedInvoiceCost: outsideValue,
    reconciliation: true,
  });
  return {
    leader: manager, startDate, endDate, billingPeriodEnd: data.settings.billingPeriodEnd,
    unit: data.usageUnit, source: data.usageSource, currency: data.settings.currency,
    workspaceUsage, workspaceUsageValue: demoUsageValue(workspaceUsage, data), estimatedInvoice: null,
    invoiceSnapshotPeriod: data.settings.billingPeriodStart && data.settings.billingPeriodEnd ? `${data.settings.billingPeriodStart} – ${data.settings.billingPeriodEnd}` : null,
    invoiceAllocationAvailable: false,
    selectedOrgUsage, selectedOrgInvoiceShare: workspaceUsage > 0 ? selectedOrgUsage / workspaceUsage : 0,
    selectedOrgAllocatedCost: demoUsageValue(selectedOrgUsage, data),
    mappedMembers: selectedMemberIds.size, unresolvedMembers: data.members.length - selectedMemberIds.size,
    rows, warning: null,
  };
}
