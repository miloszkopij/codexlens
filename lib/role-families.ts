export type RoleFamily = "Data" | "Software" | "Product" | "Design" | "Other";

export const roleFamilies: RoleFamily[] = ["Data", "Software", "Product", "Design", "Other"];

export function classifyPeopleRoleFamily(title: string | null | undefined): RoleFamily {
  const normalized = String(title ?? "").trim().toLowerCase();
  if (!normalized) return "Other";
  if (/\bdata\b|analytics|machine learning|\bai\b|artificial intelligence|data scientist|statistician|\banalyst\b/.test(normalized)) return "Data";
  if (/software|developer|development|engineering|engineer|devops|platform|systems?|architect|it support|it services|administrator|quality assurance|\bqa\b|test automation|applications?/.test(normalized)) return "Software";
  if (/product|program|project|process|promoter success|strategy and transformation/.test(normalized)) return "Product";
  if (/design|\bux\b|user experience|research|insights/.test(normalized)) return "Design";
  return "Other";
}
