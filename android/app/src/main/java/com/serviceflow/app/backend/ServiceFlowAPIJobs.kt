package com.serviceflow.app.backend

import com.serviceflow.core.BudgetProgress
import com.serviceflow.core.ISODate
import com.serviceflow.core.JSONValue
import com.serviceflow.core.Project
import com.serviceflow.core.TimeEntry
import com.serviceflow.core.TimeEntryCommand
import com.serviceflow.core.TodayBoard
import com.serviceflow.core.TodayJob
import com.serviceflow.core.arrayValue
import com.serviceflow.core.get
import com.serviceflow.core.nonEmptyString
import com.serviceflow.core.stringValue
import io.github.jan.supabase.postgrest.query.Order
import io.github.jan.supabase.postgrest.query.filter.PostgrestFilterBuilder
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.serialization.json.JsonPrimitive
import java.time.Instant

// Jobs, leads, budgets and assignments.

private val activeStatuses = listOf("scheduled", "active")
private const val PAGE_LIMIT = 1000

/** Visible jobs (`job_feed` applies each job's own visibility flag), in the active company. */
private fun ServiceFlowAPI.jobFeed(filter: PostgrestFilterBuilder) = with(filter) {
    scoped()
    eq("is_feed_visible", true)
}

private fun ServiceFlowAPI.activeJobs(filter: PostgrestFilterBuilder) = with(filter) {
    jobFeed(this)
    isIn("status", activeStatuses)
}

/** Every scheduled or active job with coordinates (for the map and suggestions). */
suspend fun ServiceFlowAPI.mappedProjects(): List<Project> {
    val all = mutableListOf<Project>()
    var from = 0L
    while (true) {
        val start = from
        val page = rows("job_feed", "*") {
            filter { activeJobs(this) }
            order("updated_at", Order.DESCENDING)
            range(start, start + PAGE_LIMIT - 1)
        }
        all += page.mapNotNull { Project.fromJobRow(it) }.filter { it.isListable && it.coordinate != null }
        if (page.size < PAGE_LIMIT) return all
        from += PAGE_LIMIT
    }
}

/** One page of active jobs, optionally limited to [ids]. */
suspend fun ServiceFlowAPI.activeProjects(page: Int, pageSize: Int, ids: List<String>?): List<Project> {
    if (ids != null && ids.isEmpty()) return emptyList()
    val start = page.toLong() * pageSize
    return rows("job_feed", "*") {
        filter {
            activeJobs(this)
            if (ids != null) isIn("id", ids)
        }
        order("updated_at", Order.DESCENDING)
        range(start, start + pageSize - 1)
    }.mapNotNull { Project.fromJobRow(it) }.filter { it.isListable }
}

/** The most recently updated active job. */
suspend fun ServiceFlowAPI.latestActiveProject(): Project? =
    rows("job_feed", "*") {
        filter { activeJobs(this) }
        order("updated_at", Order.DESCENDING)
        limit(5)
    }.mapNotNull { Project.fromJobRow(it) }.firstOrNull { it.isListable }

// MARK: Search

/** Jobs and unconverted leads matching [text] (name, contact, address, phone). */
suspend fun ServiceFlowAPI.searchProjects(text: String, limit: Int = 50): List<Project> {
    val pattern = ServiceFlowAPI.likePattern(text) ?: return emptyList()
    val contactIds = matchingContactIds(pattern, digits = text.filter(Char::isDigit))
    val leadRows = matchingLeadRows(pattern, contactIds)
    val leadJobIds = leadRows.flatMap { it["jobs"].arrayValue ?: emptyList() }.mapNotNull { it["id"].nonEmptyString }
    val jobRows = matchingJobRows(pattern, alsoIds = leadJobIds)

    val jobs = jobRows.mapNotNull { Project.fromJobRow(it) }
    // A lead with a job shows as that job.
    val leads = leadRows.filter { (it["jobs"].arrayValue ?: emptyList()).isEmpty() }.mapNotNull { Project.fromLeadRow(it) }
    return (jobs + leads)
        .filter { !it.isHiddenTestProject }
        .sortedByDescending { it.updatedAt ?: it.createdAt ?: Instant.MIN }
        .take(limit)
}

private suspend fun ServiceFlowAPI.matchingContactIds(pattern: String, digits: String): List<String> =
    rows("contacts", "id") {
        filter {
            scoped()
            or {
                ilike("name", pattern)
                ilike("email", pattern)
                // Phone numbers are stored in many formats, so match on digits only.
                if (digits.length >= 3) ilike("phone", "%$digits%")
            }
        }
        limit(PAGE_LIMIT.toLong())
    }.mapNotNull { it["id"].nonEmptyString }

private suspend fun ServiceFlowAPI.matchingLeadRows(pattern: String, contactIds: List<String>): List<JSONValue> =
    rows("leads", "*,contact:contacts(id,name,email,phone),jobs(id)") {
        filter {
            scoped()
            or {
                listOf("address", "city", "province", "postal_code", "source", "pipeline_stage_raw").forEach { ilike(it, pattern) }
                if (contactIds.isNotEmpty()) isIn("contact_id", contactIds)
            }
        }
        order("updated_at", Order.DESCENDING)
        limit(PAGE_LIMIT.toLong())
    }

private suspend fun ServiceFlowAPI.matchingJobRows(pattern: String, alsoIds: List<String>): List<JSONValue> =
    rows("job_feed", "*") {
        filter {
            jobFeed(this)
            // Completed jobs are searchable too; archived and cancelled ones aren't.
            neq("status", "archived")
            neq("status", "cancelled")
            or {
                listOf("name", "formatted_address", "city", "province", "postal_code").forEach { ilike(it, pattern) }
                if (alsoIds.isNotEmpty()) isIn("id", alsoIds)
            }
        }
        order("updated_at", Order.DESCENDING)
        limit(PAGE_LIMIT.toLong())
    }

// MARK: Budgets and assignments

suspend fun ServiceFlowAPI.budgets(jobIds: List<String>): Map<String, BudgetProgress> {
    val result = mutableMapOf<String, BudgetProgress>()
    // Keep each request's URL short: 100 ids at a time.
    for (chunk in jobIds.chunked(100)) {
        val page = rows("job_feed", "id,status,budget_minutes,used_minutes,budget_percent_used,budget_status,updated_at") {
            filter { isIn("id", chunk) }
        }
        page.mapNotNull { BudgetProgress.fromJobFeedRow(it) }.forEach { result[it.jobId] = it }
    }
    return result
}

// MARK: Today (managers)

/**
 * The jobs someone clocked in to since [startOfDay] (or is still clocked in
 * to), with everyone who has worked them.
 */
suspend fun ServiceFlowAPI.todayJobs(startOfDay: Instant, now: Instant = Instant.now()): List<TodayJob> = coroutineScope {
    val statuses = listOf("active", "completed")
    val ids = rows("time_entries", "job_id") {
        filter {
            scoped()
            isIn("status", statuses)
            or {
                eq("status", "active")
                gte("started_at", ISODate.string(startOfDay))
            }
        }
        limit(PAGE_LIMIT.toLong())
    }.mapNotNull { it["job_id"].nonEmptyString }.toSet().sorted()
    if (ids.isEmpty()) return@coroutineScope emptyList()

    val feed = async {
        rows("job_feed", "*") {
            filter {
                jobFeed(this)
                isIn("id", ids)
            }
        }
    }
    val history = mutableListOf<JSONValue>()
    while (true) {
        val from = history.size.toLong()
        val page = rows(
            "time_entries",
            "id,employee_id,employee_name,job_id,started_at,ended_at,status,clock_in_latitude,clock_in_longitude,last_distance_meters",
        ) {
            filter {
                isIn("job_id", ids)
                isIn("status", statuses)
            }
            order("started_at", Order.ASCENDING)
            order("id", Order.ASCENDING)
            range(from, from + PAGE_LIMIT - 1)
        }
        history += page
        if (page.size < PAGE_LIMIT) break
    }
    TodayBoard.jobs(
        entries = history.mapNotNull { TimeEntry.fromServerRow(it, now) },
        projects = feed.await().mapNotNull { Project.fromJobRow(it) },
        startOfDay = startOfDay, now = now,
    )
}

// MARK: Leads as jobs, descriptions

/** The job for a lead: its open job, else a new one (as clocking into a lead makes). */
suspend fun ServiceFlowAPI.leadJob(leadId: String): Project =
    TimeEntryCommand.firstRow(ensureLeadClockInJob(leadId))?.let { Project.fromJobRow(it) }
        ?: throw IllegalStateException("The lead could not be opened as a job. Try again.")

/** The job's description, or null when it has none. */
suspend fun ServiceFlowAPI.jobDescription(jobId: String): String? =
    rows("job_descriptions", "body") {
        filter { eq("job_id", jobId) }
        limit(1)
    }.firstOrNull()?.get("body").nonEmptyString

/** Saves the description (blank removes it); managers only. Returns the saved text. */
suspend fun ServiceFlowAPI.setJobDescription(jobId: String, body: String): String =
    rpc("set_job_description", mapOf("requested_job_id" to JsonPrimitive(jobId), "requested_body" to JsonPrimitive(body)))
        .stringValue.orEmpty()

suspend fun ServiceFlowAPI.assignedJobIds(userId: String): List<String> =
    rows("job_assignments", "job_id") {
        filter {
            scoped()
            eq("employee_id", userId)
            eq("status", "active")
        }
    }.mapNotNull { it["job_id"].nonEmptyString }
