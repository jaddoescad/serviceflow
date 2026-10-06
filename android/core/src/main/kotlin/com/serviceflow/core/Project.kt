package com.serviceflow.core

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.time.Instant

/**
 * A job (`job_feed` row) or an unconverted lead that the crew can see.
 *
 * The Swift initializer drops invalid coordinates. Here the constructor keeps
 * values as given (so `copy` stays public); the row decoders, where
 * coordinates come from, apply [validCoordinate].
 */
@Serializable
data class Project(
    val id: String,
    val name: String,
    val status: String? = null,
    val formattedAddress: String? = null,
    val addressLine1: String? = null,
    val addressLine2: String? = null,
    val city: String? = null,
    val province: String? = null,
    val postalCode: String? = null,
    val latitude: Double? = null,
    val longitude: Double? = null,
    @Serializable(with = InstantSerializer::class) val updatedAt: Instant? = null,
    @Serializable(with = InstantSerializer::class) val createdAt: Instant? = null,
    val isLead: Boolean = false,
    /** Pipeline stage shown on lead badges (`proposal_sent`). */
    val leadStage: String? = null,
    /** For a job, the lead it was converted from (its photos belong to the job too). */
    val linkedLeadId: String? = null,
    val contactName: String? = null,
    val budget: BudgetProgress? = null,
) {
    val isArchived: Boolean get() = status == "archived"
    val isCancelled: Boolean get() = status == "cancelled"
    val kind: ProjectKind get() = if (isLead) ProjectKind.Lead else ProjectKind.Job

    val coordinate: Coordinate?
        get() {
            val latitude = latitude ?: return null
            val longitude = longitude ?: return null
            return Coordinate(latitude, longitude)
        }

    /** Full address: the formatted address, else the address parts joined. */
    val fullAddress: String?
        get() {
            formattedAddress.nonBlank?.let { return it }
            val parts = listOf(addressLine1, addressLine2, city, province, postalCode).mapNotNull { it.nonBlank }
            return if (parts.isEmpty()) null else parts.joinToString(", ")
        }

    /**
     * The address line shown on cards: the formatted address, else
     * "City, Province, Postal code".
     */
    val cardAddress: String?
        get() {
            formattedAddress.nonBlank?.let { return it }
            val parts = listOf(city, province, postalCode).mapNotNull { it.nonBlank }
            return if (parts.isEmpty()) null else parts.joinToString(", ")
        }

    /** Test and placeholder jobs that must never show in the app. */
    val isHiddenTestProject: Boolean
        get() = Regex("qa web smoke|do not use", RegexOption.IGNORE_CASE).containsMatchIn(name)

    /** Stage shown on the lead badge: `proposal_sent` → `Proposal Sent`. */
    val leadStageLabel: String
        get() {
            val raw = leadStage.nonBlank ?: status.nonBlank ?: "new"
            return raw.replace(Regex("[_-]+"), " ")
                .split(" ")
                .filter { it.isNotEmpty() }
                .joinToString(" ") { it.take(1).uppercase() + it.drop(1) }
        }

    /** Jobs shown in lists: not cancelled, not archived, not test jobs. */
    val isListable: Boolean get() = !isCancelled && !isArchived && !isHiddenTestProject

    companion object {
        /**
         * Latitude must be in [-90, 90] and longitude in [-180, 180]; exactly
         * (0, 0) means "never geocoded".
         */
        fun validCoordinate(latitude: Double?, longitude: Double?): Pair<Double?, Double?> {
            if (latitude == null || longitude == null || !latitude.isFinite() || !longitude.isFinite() ||
                latitude !in -90.0..90.0 || longitude !in -180.0..180.0 || (latitude == 0.0 && longitude == 0.0)
            ) return null to null
            return latitude to longitude
        }

        // MARK: Decoding server rows

        /** A `job_feed` view row, or a `jobs` row returned by `ensure_lead_clock_in_job`. */
        fun fromJobRow(row: JSONValue?): Project? {
            val id = row["id"].nonEmptyString ?: return null
            val (latitude, longitude) = validCoordinate(row["latitude"].doubleValue, row["longitude"].doubleValue)
            return Project(
                id = id,
                name = row["name"].nonEmptyString ?: "Project",
                status = row["status"].nonEmptyString,
                formattedAddress = row["formatted_address"].nonEmptyString,
                addressLine1 = row["address_line_1"].nonEmptyString,
                addressLine2 = row["address_line_2"].nonEmptyString,
                city = row["city"].nonEmptyString,
                province = row["province"].nonEmptyString,
                postalCode = row["postal_code"].nonEmptyString,
                latitude = latitude,
                longitude = longitude,
                updatedAt = row["updated_at"].dateValue,
                createdAt = row["created_at"].dateValue,
                isLead = false,
                linkedLeadId = row["lead_id"].nonEmptyString,
                budget = BudgetProgress.fromJobFeedRow(row, includeBudgetHours = true),
            )
        }

        /** A `leads` row selected with `contact:contacts(id,name,email,phone)`. */
        fun fromLeadRow(row: JSONValue?): Project? {
            val id = row["id"].nonEmptyString ?: return null
            val contactName = row["contact"]["name"].nonEmptyString
            val parts = listOf("address_line_1", "city", "province", "postal_code").mapNotNull { row[it].nonEmptyString }
            val (latitude, longitude) = validCoordinate(row["latitude"].doubleValue, row["longitude"].doubleValue)
            return Project(
                id = id,
                name = contactName ?: row["name"].nonEmptyString ?: "Unnamed lead",
                status = row["status"].nonEmptyString,
                formattedAddress = row["address"].nonEmptyString ?: (if (parts.isEmpty()) null else parts.joinToString(", ")),
                addressLine1 = row["address_line_1"].nonEmptyString,
                city = row["city"].nonEmptyString,
                province = row["province"].nonEmptyString,
                postalCode = row["postal_code"].nonEmptyString,
                latitude = latitude,
                longitude = longitude,
                updatedAt = row["updated_at"].dateValue,
                createdAt = row["created_at"].dateValue,
                isLead = true,
                leadStage = row["pipeline_stage_raw"].nonEmptyString ?: row["status"].nonEmptyString ?: "new",
                contactName = contactName,
            )
        }
    }
}

@Serializable
enum class ProjectKind(val rawValue: String) {
    @SerialName("job") Job("job"),
    @SerialName("lead") Lead("lead");

    /** Path segment used by the media worker (`/v1/jobs/…`, `/v1/leads/…`). */
    val mediaPathSegment: String get() = if (this == Job) "jobs" else "leads"

    companion object {
        fun fromRaw(value: String?): ProjectKind? = entries.firstOrNull { it.rawValue == value }
    }
}

@Serializable
data class Coordinate(val latitude: Double, val longitude: Double)

/** The trimmed value, or null when missing or blank. */
internal val String?.nonBlank: String?
    get() = this?.trim()?.takeIf { it.isNotEmpty() }
