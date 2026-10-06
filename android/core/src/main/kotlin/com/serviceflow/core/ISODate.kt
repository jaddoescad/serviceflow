package com.serviceflow.core

import kotlinx.serialization.KSerializer
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.time.temporal.ChronoUnit

/**
 * ISO-8601 timestamps as the server and the iOS app write them
 * (`2026-09-26T14:05:09.123Z`). Parsing also accepts Postgres output such as
 * `2026-09-26T14:05:09.123456+00:00` and values without fractional seconds.
 */
object ISODate {
    private val output = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC)

    fun string(date: Instant): String = output.format(date)

    fun parse(value: String?): Instant? {
        var text = value?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        if (' ' in text && 'T' !in text) text = text.replace(' ', 'T')
        // Postgres writes `+00` without minutes.
        text = Regex("([+-]\\d{2})$").replace(text, "$1:00")
        return try {
            OffsetDateTime.parse(text, DateTimeFormatter.ISO_OFFSET_DATE_TIME).toInstant().truncatedTo(ChronoUnit.MILLIS)
        } catch (_: DateTimeParseException) {
            null
        }
    }
}

/** Instants on disk: ISO text; also reads epoch milliseconds. */
object InstantSerializer : KSerializer<Instant> {
    override val descriptor = PrimitiveSerialDescriptor("ISOInstant", PrimitiveKind.STRING)

    override fun serialize(encoder: Encoder, value: Instant) = encoder.encodeString(ISODate.string(value))

    override fun deserialize(decoder: Decoder): Instant {
        if (decoder is JsonDecoder) {
            val element = decoder.decodeJsonElement() as? JsonPrimitive
                ?: throw IllegalArgumentException("Invalid date")
            if (element.isString) return ISODate.parse(element.content) ?: throw IllegalArgumentException("Invalid date")
            val millis = element.doubleOrNull ?: throw IllegalArgumentException("Invalid date")
            return Instant.ofEpochMilli(millis.toLong())
        }
        return ISODate.parse(decoder.decodeString()) ?: throw IllegalArgumentException("Invalid date")
    }
}

/** UUIDs on disk as Swift's Codable writes them (uppercase); reads any case. */
object UUIDSerializer : KSerializer<java.util.UUID> {
    override val descriptor = PrimitiveSerialDescriptor("UUID", PrimitiveKind.STRING)

    override fun serialize(encoder: Encoder, value: java.util.UUID) = encoder.encodeString(value.toString().uppercase())

    override fun deserialize(decoder: Decoder): java.util.UUID = java.util.UUID.fromString(decoder.decodeString())
}
