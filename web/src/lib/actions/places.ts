"use server";

import { headers } from "next/headers";
import { requireMember } from "@/lib/auth";

export type AddressSuggestion = { id: string; main: string; secondary: string };

const PLACES = "https://places.googleapis.com/v1";
const SESSION = /^[0-9a-f-]{36}$/;
const PLACE_ID = /^[A-Za-z0-9_-]{1,300}$/;

/** Addresses matching what's typed, from Google Places. With no
 * GOOGLE_PLACES_API_KEY set, or when Google can't answer, there are none and
 * the field stays a plain text box. */
export async function suggestAddresses(input: string, session: string): Promise<AddressSuggestion[]> {
  await requireMember();
  const key = process.env.GOOGLE_PLACES_API_KEY;
  const text = input.trim().slice(0, 200);
  if (!key || text.length < 3 || !SESSION.test(session)) return [];

  // Google biases to the caller's IP, which on Vercel is the server's, so
  // bias to where the person typing is instead.
  const request = await headers();
  const latitude = Number(request.get("x-vercel-ip-latitude"));
  const longitude = Number(request.get("x-vercel-ip-longitude"));
  const near =
    request.has("x-vercel-ip-latitude") && Number.isFinite(latitude) && Number.isFinite(longitude)
      ? { locationBias: { circle: { center: { latitude, longitude }, radius: 50_000 } } }
      : {};

  const response = await fetch(`${PLACES}/places:autocomplete`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key },
    body: JSON.stringify({
      input: text,
      sessionToken: session,
      includedPrimaryTypes: ["street_address", "premise", "subpremise", "route"],
      languageCode: "en",
      ...near,
    }),
    cache: "no-store",
  }).catch(() => null);
  if (!response?.ok) return [];
  const body = (await response.json()) as {
    suggestions?: {
      placePrediction?: {
        placeId: string;
        text: { text: string };
        structuredFormat?: { mainText: { text: string }; secondaryText?: { text: string } };
      };
    }[];
  };
  return (body.suggestions ?? []).flatMap(({ placePrediction: place }) =>
    place
      ? [
          {
            id: place.placeId,
            main: place.structuredFormat?.mainText.text ?? place.text.text,
            secondary: place.structuredFormat?.secondaryText?.text ?? "",
          },
        ]
      : [],
  );
}

/** The full address of a picked suggestion, with its postal code and without
 * the country. Ending the session here is what Google bills, once. */
export async function addressDetails(id: string, session: string): Promise<string | null> {
  await requireMember();
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key || !PLACE_ID.test(id) || !SESSION.test(session)) return null;
  const response = await fetch(`${PLACES}/places/${id}?sessionToken=${session}&languageCode=en`, {
    headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": "formattedAddress,addressComponents" },
    cache: "no-store",
  }).catch(() => null);
  if (!response?.ok) return null;
  const place = (await response.json()) as {
    formattedAddress?: string;
    addressComponents?: { longText: string; types: string[] }[];
  };
  const country = place.addressComponents?.find((part) => part.types.includes("country"))?.longText;
  const address = place.formattedAddress ?? "";
  return (country && address.endsWith(`, ${country}`) ? address.slice(0, -country.length - 2) : address) || null;
}
