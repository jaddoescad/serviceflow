package com.serviceflow.core

import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import java.time.Instant
import kotlin.math.roundToLong

/**
 * An arbitrary JSON value, used for RPC payloads and for the loosely typed
 * jsonb columns (`metadata`, `source_metadata`, RPC responses).
 *
 * The accessors below are null-safe so rows read like the iOS app:
 * `row["job"]["name"].nonEmptyString`.
 */
typealias JSONValue = JsonElement

operator fun JsonElement?.get(key: String): JsonElement? = (this as? JsonObject)?.get(key)

val JsonElement?.isNull: Boolean get() = this == null || this is JsonNull

val JsonElement?.stringValue: String?
    get() {
        val primitive = this as? JsonPrimitive ?: return null
        if (primitive is JsonNull) return null
        if (primitive.isString) return primitive.content
        if (primitive.booleanOrNull != null) return null
        val number = primitive.doubleOrNull ?: return null
        return if (number.isFinite() && number == Math.rint(number) && kotlin.math.abs(number) < 9.0e15) {
            number.roundToLong().toString()
        } else {
            number.toString()
        }
    }

/** The trimmed string, or null when it is missing or blank. */
val JsonElement?.nonEmptyString: String?
    get() = stringValue?.trim()?.takeIf { it.isNotEmpty() }

val JsonElement?.doubleValue: Double?
    get() {
        val primitive = this as? JsonPrimitive ?: return null
        if (primitive is JsonNull || primitive.booleanOrNull != null && !primitive.isString) return null
        val value = if (primitive.isString) primitive.content.trim().toDoubleOrNull() else primitive.doubleOrNull
        return value?.takeIf { it.isFinite() }
    }

/** Rounded like Swift's `rounded()` (halves away from zero). */
val JsonElement?.intValue: Int? get() = doubleValue?.roundedSwift()?.toInt()

val JsonElement?.boolValue: Boolean?
    get() {
        val primitive = this as? JsonPrimitive ?: return null
        return if (primitive.isString) null else primitive.booleanOrNull
    }

val JsonElement?.arrayValue: List<JsonElement>? get() = this as? JsonArray

val JsonElement?.objectValue: Map<String, JsonElement>? get() = this as? JsonObject

/** ISO-8601 text, or epoch milliseconds. */
val JsonElement?.dateValue: Instant?
    get() {
        val primitive = this as? JsonPrimitive ?: return null
        if (primitive is JsonNull) return null
        if (primitive.isString) return ISODate.parse(primitive.content)
        return primitive.doubleOrNull?.let { Instant.ofEpochMilli(it.roundToLong()) }
    }

// MARK: Building values

fun json(value: String?): JsonElement = value?.let(::JsonPrimitive) ?: JsonNull
fun json(value: Number?): JsonElement = value?.let(::JsonPrimitive) ?: JsonNull
fun json(value: Boolean?): JsonElement = value?.let(::JsonPrimitive) ?: JsonNull
fun json(value: Instant?): JsonElement = value?.let { JsonPrimitive(ISODate.string(it)) } ?: JsonNull
fun json(values: List<JsonElement>): JsonElement = JsonArray(values)

/**
 * `jsonObject("action" to "clock_in", "count" to 2, "next" to null)`.
 * Values may be JSON elements, strings, numbers, booleans, instants, lists,
 * maps or null.
 */
fun jsonObject(vararg pairs: Pair<String, Any?>): JsonObject = JsonObject(pairs.associate { it.first to toJson(it.second) })

fun jsonArray(vararg values: Any?): JsonArray = JsonArray(values.map(::toJson))

fun toJson(value: Any?): JsonElement = when (value) {
    null -> JsonNull
    is JsonElement -> value
    is String -> JsonPrimitive(value)
    is Number -> JsonPrimitive(value)
    is Boolean -> JsonPrimitive(value)
    is Instant -> JsonPrimitive(ISODate.string(value))
    is Map<*, *> -> JsonObject(value.entries.associate { it.key.toString() to toJson(it.value) })
    is Iterable<*> -> JsonArray(value.map(::toJson))
    is Array<*> -> JsonArray(value.map(::toJson))
    else -> throw IllegalArgumentException("Not a JSON value: ${value::class}")
}

/** A copy of an object with `key` set (or added). */
fun JsonElement.with(key: String, value: Any?): JsonObject =
    JsonObject(((this as? JsonObject) ?: JsonObject(emptyMap())) + (key to toJson(value)))

/** The JSON configuration used for files on disk and for decoding rows. */
object JSONCoding {
    val json: Json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
        explicitNulls = false
        coerceInputValues = true
    }

    fun <T> encode(serializer: KSerializer<T>, value: T): JsonElement = json.encodeToJsonElement(serializer, value)
    fun <T> decode(serializer: KSerializer<T>, value: JsonElement): T = json.decodeFromJsonElement(serializer, value)
}
