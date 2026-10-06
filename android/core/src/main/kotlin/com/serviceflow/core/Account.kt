package com.serviceflow.core

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** A company the person belongs to (`org_members` joined to `organizations`). */
@Serializable
data class CompanyMembership(
    val orgId: String,
    val name: String,
    val role: Role,
    val trade: String? = null,
) {
    @Serializable
    enum class Role(val rawValue: String) {
        @SerialName("owner") Owner("owner"),
        @SerialName("admin") Admin("admin"),
        @SerialName("manager") Manager("manager"),
        @SerialName("crew") Crew("crew");

        companion object {
            fun fromRaw(value: String?): Role? = entries.firstOrNull { it.rawValue == value }
        }
    }

    val id: String get() = orgId

    /** Owners, admins and managers run the company: team time. */
    val isManager: Boolean get() = role != Role.Crew

    companion object {
        fun fromRow(row: JSONValue?): CompanyMembership? {
            val orgId = row["org_id"].nonEmptyString ?: return null
            val organization = row["organization"] ?: row["organizations"]
            if (!(organization["status"].stringValue?.let { it == "active" } ?: true)) return null
            return CompanyMembership(
                orgId = orgId,
                name = organization["name"].nonEmptyString ?: "Company",
                role = Role.fromRaw(row["role"].stringValue ?: "") ?: Role.Crew,
                trade = organization["trade"].nonEmptyString,
            )
        }
    }
}

object AccountValidation {
    fun email(value: String): String? {
        val trimmed = value.trim()
        if (trimmed.isEmpty()) return "Enter your email address."
        return if (Regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$").containsMatchIn(trimmed)) null else "Enter a valid email address."
    }

    fun password(value: String): String? =
        if (value.codePointCount(0, value.length) < 8) "Use at least 8 characters." else null

    fun name(value: String): String? = if (value.trim().isEmpty()) "Enter your name." else null

    fun companyName(value: String): String? {
        val trimmed = value.trim()
        val count = trimmed.codePointCount(0, trimmed.length)
        if (count < 2) return "Enter your company's name."
        if (count > 80) return "Use 80 characters or fewer."
        return null
    }

    /** Six-digit email code. */
    fun verificationCode(value: String): String = value.filter { it.isDigit() }.take(6)
}

object DisplayName {
    /** Profile name, then auth metadata, then the email's local part. */
    fun resolve(profileName: String?, metadataName: String?, email: String?): String {
        profileName.nonBlank?.let { return it }
        metadataName.nonBlank?.let { return it }
        val local = email?.split("@")?.firstOrNull { it.isNotEmpty() }
        // Swift's split drops empty pieces, so "@x" yields "x".
        if (!local.isNullOrEmpty()) return local
        return "Crew member"
    }
}
