export type ManagedTargetGroup = "PM" | "Developers" | "white-collar" | "SEC";

export function classifyPeopleRole(title: string | null): ManagedTargetGroup | null {
  if (!title) return null;
  if (/security|cybersecurity/i.test(title)) return "SEC";
  if (/fraud|compliance/i.test(title)) return "white-collar";
  if (/product manager|product management|\bUX\b|user experience|researcher|program manager|project manager|process management|process manager/i.test(title)) return "PM";
  if (/software|engineer|engineering|data|machine learning|analyst|analytics|platform|developer|systems?|solutions architect|test automation|quality assurance|IT support|IT services|applications administrator|API technical/i.test(title)) return "Developers";
  return null;
}
