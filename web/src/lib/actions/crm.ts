"use server";

import type {
  DealOverview,
  JobCost,
  JobSchedule,
  ReportKind,
  SalesMetrics,
} from "@/lib/crm-types";
import { staffRead, staffWrite } from "./rpc";

// Deal quick view ------------------------------------------------------

export async function getDealOverview(recordId: string): Promise<DealOverview> {
  return staffRead("get_deal_overview", { requested_record: recordId });
}

export async function setDealSettings(input: {
  recordId: string;
  salespersonId: string | null;
  projectManagerId: string | null;
  dripsPaused: boolean;
}) {
  return staffWrite(
    "set_deal_settings",
    {
      requested_record: input.recordId,
      requested_salesperson: input.salespersonId,
      requested_project_manager: input.projectManagerId,
      requested_drips_paused: input.dripsPaused,
    },
    ["/pipeline"],
  );
}

export async function saveProjectNote(input: { id: string; projectId: string; body: string }) {
  return staffWrite(
    "save_project_note",
    { requested_id: input.id, requested_project: input.projectId, requested_body: input.body },
    ["/pipeline"],
  );
}

export async function deleteProjectNote(id: string) {
  return staffWrite("delete_project_note", { requested_id: id }, ["/pipeline"]);
}

// Schedule, metrics, reports, costing ------------------------------------

export async function getJobSchedule(start: string, end: string): Promise<JobSchedule> {
  return staffRead("get_job_schedule", { range_start: start, range_end: end });
}

/**
 * Dates, optional daily times ("HH:MM", both or neither) and the crew in one
 * save; a crew's members are assigned to the job. `notify` queues the
 * customer's confirmation when the dates or times change.
 */
export async function scheduleJob(input: {
  jobId: string;
  startOn: string | null;
  endOn: string | null;
  startTime: string | null;
  endTime: string | null;
  crewId: string | null;
  notify: boolean;
}) {
  return staffWrite(
    "schedule_job",
    {
      requested_job: input.jobId,
      requested_start: input.startOn,
      requested_end: input.endOn,
      requested_notify: input.notify,
      requested_start_time: input.startTime,
      requested_end_time: input.endTime,
      requested_crew: input.crewId,
    },
    ["/schedule", "/pipeline"],
  );
}

export async function getSalesMetrics(start: string, end: string): Promise<SalesMetrics> {
  return staffRead("get_sales_metrics", { range_start: start, range_end: end });
}

export async function getReport(kind: ReportKind, start: string, end: string): Promise<Record<string, unknown>[]> {
  return staffRead("get_report", { requested_kind: kind, range_start: start, range_end: end });
}

export async function getJobCosting(): Promise<JobCost[]> {
  return staffRead("get_job_costing");
}

// Pipeline columns -------------------------------------------------------

export async function savePipelineStage(input: {
  id: string;
  pipeline: "sales" | "jobs";
  name: string;
  recordStatus: string;
  isClosed: boolean;
}) {
  return staffWrite(
    "save_pipeline_stage",
    {
      requested_id: input.id,
      requested_pipeline: input.pipeline,
      requested_name: input.name,
      requested_record_status: input.recordStatus,
      requested_is_closed: input.isClosed,
    },
    ["/pipeline", "/drips"],
  );
}

export async function movePipelineStage(id: string, direction: -1 | 1) {
  return staffWrite("move_pipeline_stage", { requested_id: id, requested_direction: direction }, ["/pipeline", "/drips"]);
}

export async function deletePipelineStage(id: string) {
  return staffWrite("delete_pipeline_stage", { requested_id: id }, ["/pipeline", "/drips"]);
}
