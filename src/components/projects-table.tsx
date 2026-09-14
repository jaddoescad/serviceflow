"use client";
import Link from "next/link";
import { useState } from "react";
import type { ProjectRollup } from "@/lib/metrics";
import { fmtHours } from "@/lib/format";
import { Card,Input } from "@/components/ui";
export function ProjectsTable({rows}:{rows:ProjectRollup[]}){
 const [search,setSearch]=useState("");
 const visible=rows.filter(row=>`${row.name} ${row.address??""}`.toLowerCase().includes(search.toLowerCase()));
 return <Card><div className="p-4"><Input aria-label="Search jobs" placeholder="Search jobs…" value={search} onChange={event=>setSearch(event.target.value)} /></div><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-y border-[var(--color-border)] text-left"><th className="p-4">Job</th><th className="p-4">Recorded hours</th><th className="p-4">Budget hours</th><th className="p-4">Remaining</th></tr></thead><tbody>{visible.map(row=><tr key={row.projectId} className="border-b border-[var(--color-border)]"><td className="p-4"><Link href={`/jobs/${row.projectId}`} className="font-medium text-[var(--color-brand-strong)]">{row.name}</Link><p className="text-xs text-[var(--color-muted)]">{row.address}</p></td><td className="p-4">{fmtHours(row.loggedHours)}</td><td className="p-4">{row.budgetedHours==null?"Not set":fmtHours(row.budgetedHours)}</td><td className="p-4">{row.remainingHours==null?"—":fmtHours(row.remainingHours)}</td></tr>)}</tbody></table></div></Card>;
}
