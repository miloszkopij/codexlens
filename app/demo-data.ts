import type { DashboardData, Member, WorkspaceGroup } from "./types";

export const demoMembers: Member[] = [
  { id: "demo-1", name: "Maya Nowak", email: "maya.nowak@example.com", workspaceRole: "Admin", peopleRole: "Senior Product Manager", department: "Customer Experience", manager: "Ola Zielińska", entity: "Allegro", groups: ["PM", "GenAI Champions"], usage: 1840, messages: 512, status: "Active", peopleMatch: "Matched" },
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
    { id: "c4", person: "Antoni Wójcik", subjectId: "demo-6", action: "Role changed", detail: "Project Manager → Program Manager", time: "Yesterday", entity: "eBilet", kind: "role", unread: true },
    { id: "c5", person: "PM", action: "Membership updated", detail: "+4 members since the last sync", time: "Yesterday", entity: "Allegro", kind: "group", unread: false },
  ],
  trend: [
    { label: "Aug 04", credits: 12800 }, { label: "Aug 08", credits: 15350 },
    { label: "Aug 12", credits: 14620 }, { label: "Aug 16", credits: 19180 },
    { label: "Aug 20", credits: 17540 }, { label: "Aug 24", credits: 22280 },
    { label: "Aug 28", credits: 20740 }, { label: "Sep 01", credits: 25840 },
  ],
};
