export const QUO_ACCESS_SCOPE_VERSION = "sales-production-v1";

export const ALLOWED_QUO_PHONE_NUMBERS = Object.freeze([
  Object.freeze({ id: "PN3Uvs2ITi", name: "Sales" }),
  Object.freeze({ id: "PNHtOrvjNR", name: "Production" }),
]);

const allowedPhoneNumberIds = new Set(ALLOWED_QUO_PHONE_NUMBERS.map(({ id }) => id));

function phoneNumberRows(body) {
  if (Array.isArray(body)) return body;
  for (const key of ["data", "items", "phoneNumbers", "results"]) {
    if (Array.isArray(body?.[key])) return body[key];
  }
  return [];
}

export function isAllowedQuoPhoneNumberId(phoneNumberId) {
  return allowedPhoneNumberIds.has(String(phoneNumberId ?? ""));
}

export function requireAllowedQuoPhoneNumberId(phoneNumberId) {
  if (!isAllowedQuoPhoneNumberId(phoneNumberId)) {
    throw new Error("Quo access is restricted to the Sales and Production phone lines");
  }
  return phoneNumberId;
}

export function allowedQuoPhoneNumberIds(body) {
  return phoneNumberRows(body)
    .map((row) => row?.id)
    .filter((id) => isAllowedQuoPhoneNumberId(id));
}

export function filterAllowedQuoPhoneNumberBody(body) {
  const filtered = phoneNumberRows(body).filter((row) => isAllowedQuoPhoneNumberId(row?.id));
  if (Array.isArray(body)) return filtered;
  if (!body || typeof body !== "object") return body;
  for (const key of ["data", "items", "phoneNumbers", "results"]) {
    if (Array.isArray(body[key])) return { ...body, [key]: filtered };
  }
  return body;
}
