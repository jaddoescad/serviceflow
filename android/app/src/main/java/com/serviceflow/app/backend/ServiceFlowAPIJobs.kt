package com.serviceflow.app.backend

import com.serviceflow.core.BudgetProgress
import com.serviceflow.core.JSONValue
import com.serviceflow.core.Project
import com.serviceflow.core.arrayValue
import com.serviceflow.core.get
import com.serviceflow.core.nonEmptyString
import io.github.jan.supabase.postgrest.query.Order
import io.github.jan.supabase.postgrest.query.filter.PostgrestFilterBuilder
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

suspend fun ServiceFlowAPI.assignedJobIds(userId: String): List<String> =
    rows("job_assignments", "job_id") {
        filter {
            scoped()
            eq("employee_id", userId)
            eq("status", "active")
        }
    }.mapNotNull { it["job_id"].nonEmptyString }
