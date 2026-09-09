import type { Metadata } from "next";
import CodexlensApp from "./ui/CodexlensApp";

export const metadata: Metadata = {
  title: "codexlens — workspace intelligence",
  description:
    "A local control surface for ChatGPT workspace members, groups, entities, changes, and usage.",
};

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Home({ searchParams }: PageProps) {
  const params = searchParams ? await searchParams : {};
  const requestedView = Array.isArray(params.view) ? params.view[0] : params.view;
  const initialView = requestedView === "analytics" || requestedView === "management" || requestedView === "members" || requestedView === "organize" || requestedView === "changes"
    ? requestedView : "overview";
  return <CodexlensApp initialView={initialView} forceDemo={params.demo === "1"} />;
}
