"use server";

import type { CrewColor, TeamOption } from "@/lib/crm-types";
import { staffRead, staffWrite } from "./rpc";

export type Crew = { id: string; name: string; color: CrewColor; leadId: string | null; memberIds: string[] };
export type CrewSettings = { crews: Crew[]; team: TeamOption[] };

export async function getCrewSettings(): Promise<CrewSettings> {
  return staffRead<CrewSettings>("get_crew_settings");
}

/** Creates or updates a crew; the id comes from the browser so a retry is harmless. */
export async function saveCrew(input: { id: string; name: string; color: CrewColor; leadId: string | null; memberIds: string[] }) {
  return staffWrite(
    "save_crew",
    {
      requested_id: input.id,
      requested_name: input.name,
      requested_color: input.color,
      requested_lead: input.leadId,
      requested_members: input.memberIds,
    },
    ["/settings", "/schedule"],
  );
}

/** Its people stay on the jobs they were assigned to. */
export async function deleteCrew(id: string) {
  return staffWrite("delete_crew", { requested_id: id }, ["/settings", "/schedule"]);
}
