package com.serviceflow.app.backend

import com.serviceflow.core.BackendError
import com.serviceflow.core.CompanyMembership
import com.serviceflow.core.ISODate
import com.serviceflow.core.JSONValue
import com.serviceflow.core.arrayValue
import com.serviceflow.core.boolValue
import com.serviceflow.core.dateValue
import com.serviceflow.core.get
import com.serviceflow.core.nonEmptyString
import com.serviceflow.core.stringValue
import io.github.jan.supabase.auth.OtpType
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.providers.builtin.Email
import io.github.jan.supabase.auth.providers.builtin.OTP
import io.github.jan.supabase.exceptions.RestException
import io.github.jan.supabase.functions.functions
import io.github.jan.supabase.postgrest.query.Order
import io.ktor.client.statement.bodyAsText
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.Instant

// Sign-in, sign-up, companies and app configuration.
//
// Auth calls throw Supabase's own errors (read with `AuthMessage`), except
// that a lost connection is reported as `BackendError.Offline`.

private suspend fun <T> authCall(work: suspend () -> T): T = try {
    work()
} catch (e: CancellationException) {
    throw e
} catch (e: java.io.IOException) {
    throw BackendError.Offline(e.message ?: "The connection failed.")
}

// MARK: Auth

suspend fun ServiceFlowAPI.signIn(email: String, password: String) = authCall {
    client.auth.signInWith(Email) {
        this.email = email
        this.password = password
    }
}

/** Sends a 6-digit code that creates the account when verified. */
suspend fun ServiceFlowAPI.sendSignUpCode(email: String, name: String) = authCall {
    client.auth.signInWith(OTP) {
        this.email = email
        createUser = true
        data = buildJsonObject { put("full_name", name) }
    }
}

/** Sends a 6-digit sign-in code to an existing account. */
suspend fun ServiceFlowAPI.sendSignInCode(email: String) = authCall {
    client.auth.signInWith(OTP) {
        this.email = email
        createUser = false
    }
}

suspend fun ServiceFlowAPI.verifyEmailCode(email: String, code: String) = authCall {
    client.auth.verifyEmailOtp(type = OtpType.Email.EMAIL, email = email, token = code)
}

/** Sends a password-reset code. */
suspend fun ServiceFlowAPI.sendPasswordResetCode(email: String) = authCall {
    client.auth.resetPasswordForEmail(email)
}

suspend fun ServiceFlowAPI.verifyPasswordResetCode(email: String, code: String) = authCall {
    client.auth.verifyEmailOtp(type = OtpType.Email.RECOVERY, email = email, token = code)
}

suspend fun ServiceFlowAPI.updateAccount(password: String? = null, name: String? = null) {
    authCall {
        client.auth.updateUser {
            if (password != null) this.password = password
            if (name != null) data = buildJsonObject { put("full_name", name) }
        }
    }
}

suspend fun ServiceFlowAPI.signOut() {
    runCatching { client.auth.signOut() }
}

/** A valid access token (refreshed if needed), for the media Worker. */
@OptIn(kotlin.time.ExperimentalTime::class)
suspend fun ServiceFlowAPI.accessToken(): String = run {
    val session = client.auth.currentSessionOrNull() ?: throw BackendError.Unauthorized("You're signed out.")
    if (session.expiresAt.epochSeconds - 60 <= Instant.now().epochSecond) client.auth.refreshCurrentSession()
    client.auth.currentAccessTokenOrNull() ?: throw BackendError.Unauthorized("You're signed out.")
}

/** Deletes the signed-in person's account through the `delete-account` function. */
suspend fun ServiceFlowAPI.deleteAccount(): AccountDeletionResult {
    val fallback = "Your account couldn't be deleted. Try again."
    return try {
        val response = ServiceFlowAPI.parse(client.functions.invoke("delete-account").bodyAsText())
        if (response["ok"].boolValue == true) AccountDeletionResult.Deleted else AccountDeletionResult.Failed(fallback)
    } catch (e: CancellationException) {
        throw e
    } catch (e: RestException) {
        // The function's JSON body is the error text.
        val body = ServiceFlowAPI.parse(e.error)
        if (e.statusCode == 409) {
            AccountDeletionResult.Blocked(body["message"].nonEmptyString ?: "Make someone else an admin first.")
        } else {
            AccountDeletionResult.Failed(body["error"].nonEmptyString ?: fallback)
        }
    } catch (e: Throwable) {
        throw ServiceFlowAPI.classify(e)
    }
}

// MARK: Profile and companies

suspend fun ServiceFlowAPI.profile(userId: String): JSONValue? =
    rows("employees", "id,email,full_name,role,is_active") {
        filter { eq("id", userId) }
        limit(1)
    }.firstOrNull()

suspend fun ServiceFlowAPI.memberships(userId: String): List<CompanyMembership> =
    rows("org_members", "org_id,role,organization:organizations(id,name,trade,status)") {
        filter {
            eq("user_id", userId)
            eq("is_active", true)
        }
        order("created_at", Order.ASCENDING)
    }.mapNotNull { CompanyMembership.fromRow(it) }

suspend fun ServiceFlowAPI.createCompany(name: String, trade: String?): JSONValue =
    rpc("create_company", mapOf("requested_name" to JsonPrimitive(name),
                                "requested_trade" to (trade?.let(::JsonPrimitive) ?: JsonNull)))

/** Joins every company that invited the signed-in person's email. Returns the companies joined (usually none). */
suspend fun ServiceFlowAPI.acceptMyInvitations(): List<JSONValue> = rpc("accept_my_invitations").arrayValue ?: emptyList()

/** Invites an email to a company (managers). They join when they sign in with it. */
suspend fun ServiceFlowAPI.invite(email: String, role: CompanyMembership.Role, orgId: String): JSONValue =
    rpc("invite_to_company", mapOf(
        "requested_email" to JsonPrimitive(email),
        "requested_role" to JsonPrimitive(role.rawValue),
        "requested_org_id" to JsonPrimitive(orgId),
    ))

/** Open invitations of a company, newest first. */
suspend fun ServiceFlowAPI.pendingInvitations(orgId: String): List<PendingInvitation> =
    rows("org_invitations", "id,email,role,created_at,expires_at") {
        filter {
            eq("org_id", orgId)
            exact("accepted_at", null)
            exact("revoked_at", null)
            gt("expires_at", ISODate.string(Instant.now()))
        }
        order("created_at", Order.DESCENDING)
    }.mapNotNull { PendingInvitation.fromRow(it) }

suspend fun ServiceFlowAPI.revokeInvitation(id: String) {
    rpc("revoke_invitation", mapOf("invitation_id" to JsonPrimitive(id)))
}

// MARK: App

suspend fun ServiceFlowAPI.maintenanceMode(): Boolean {
    val result = runCatching {
        rows("app_config", "maintenance_mode") {
            filter { eq("id", "default") }
            limit(1)
        }
    }.getOrNull()
    return result?.firstOrNull()?.get("maintenance_mode").boolValue == true
}

// Push tokens: not registered on Android yet. The server only delivers Expo
// tokens (iOS registers an APNs token that isn't delivered either).

/** An invitation that hasn't been used yet. */
data class PendingInvitation(
    val id: String,
    val email: String,
    val role: CompanyMembership.Role,
    val expiresAt: Instant?,
) {
    companion object {
        fun fromRow(row: JSONValue): PendingInvitation? {
            val id = row["id"].nonEmptyString ?: return null
            val email = row["email"].nonEmptyString ?: return null
            return PendingInvitation(
                id = id,
                email = email,
                role = CompanyMembership.Role.fromRaw(row["role"].stringValue ?: "") ?: CompanyMembership.Role.Crew,
                expiresAt = row["expires_at"].dateValue,
            )
        }
    }
}
