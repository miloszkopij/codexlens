"use client";
import { useState } from "react";
import type { DashboardData } from "../types";
import RoleGroupMappingsView from "./RoleGroupMappingsView";
import ImportedRolesView from "./ImportedRolesView";

export default function PermissionsView(props: { data: DashboardData; onNotice: (message: string) => void }) {
  const [view, setView] = useState<"current" | "plan">("current");
  return <>
    <div className="permission-navigation segmented-filter" aria-label="Role data view">
      <button aria-pressed={view === "current"} onClick={() => setView("current")}>Current OpenAI configuration</button>
      <button aria-pressed={view === "plan"} onClick={() => setView("plan")}>Local mapping plan</button>
    </div>
    <div hidden={view !== "current"}><ImportedRolesView {...props} /></div>
    <div hidden={view !== "plan"}><RoleGroupMappingsView {...props} /></div>
  </>;
}
