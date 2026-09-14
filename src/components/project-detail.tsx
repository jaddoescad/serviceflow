"use client";
import Link from "next/link";
import { useState,useTransition } from "react";
import type { ProjectRollup } from "@/lib/metrics";
import { fmtHours,fmtMoney } from "@/lib/format";
import { Card,Button } from "@/components/ui";
import { setLabourClosed } from "@/lib/actions/budgets";
export function ProjectOverviewPanel({project,canManage}:{project:ProjectRollup;detail:unknown;canManage:boolean}){
 const [pending,startTransition]=useTransition();const [error,setError]=useState<string|null>(null);
 return <Card className="p-5"><h2 className="font-semibold">Labour budget</h2><div className="my-5 grid gap-4 sm:grid-cols-3">{[["Recorded hours",fmtHours(project.loggedHours)],["Budget hours",project.budgetedHours==null?"Not set":fmtHours(project.budgetedHours)],["Remaining hours",project.remainingHours==null?"—":fmtHours(project.remainingHours)]].map(([label,value])=><div key={label}><p className="text-xs text-[var(--color-muted)]">{label}</p><p className="mt-1 text-xl font-semibold">{value}</p></div>)}</div><p className="text-sm">Budget hourly rate: {project.hourlyRate==null?"Not set":fmtMoney(project.hourlyRate)}</p>{canManage?<div className="mt-5 flex items-center gap-4"><Link href={`/jobs/${project.projectId}/calculator`} className="text-sm text-[var(--color-brand-strong)]">Edit budget in calculator →</Link><Button disabled={pending} onClick={()=>startTransition(async()=>{const result=await setLabourClosed({projectId:project.projectId,closed:!project.labourClosedAt});if(!result.ok)setError(result.error??"Could not update job");})}>{project.labourClosedAt?"Reopen job":"Mark job completed"}</Button></div>:null}{error?<p role="alert" className="mt-3 text-sm">{error}</p>:null}</Card>;
}
