export type PushMessage = {
  to: string;
  title: string;
  body: string;
  sound?: string;
  data?: Record<string, unknown>;
};

export type PushTicket = {
  status: "ok" | "error";
  id?: string;
  details?: { error?: string };
};

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const APNS_PUSH_URL = "https://api.push.apple.com/3/device/";
const encoder = new TextEncoder();
let signingKey: Promise<CryptoKey> | undefined;
let providerToken: { issuedAt: number; value: Promise<string> } | undefined;

/** Keeps ticket order stable when a batch contains both native and Expo installs. */
export async function sendPushBatch(
  messages: PushMessage[],
): Promise<PushTicket[]> {
  const tickets = messages.map(() => failure("UnsupportedPushToken"));
  const expo = messages.flatMap((message, index) =>
    /^(ExponentPushToken|ExpoPushToken)\[.+\]$/.test(message.to)
      ? [{ message, index }]
      : []
  );
  const native = messages.flatMap((message, index) =>
    message.to.startsWith("apns:") ? [{ message, index }] : []
  );

  await Promise.all([
    (async () => {
      if (!expo.length) return;
      try {
        const response = await fetch(EXPO_PUSH_URL, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(expo.map(({ message }) => message)),
          signal: AbortSignal.timeout(15_000),
        });
        const payload = await response.json().catch(() => ({}));
        for (const [offset, { index }] of expo.entries()) {
          tickets[index] = response.ok && Array.isArray(payload?.data)
            ? payload.data[offset] ?? failure("ExpoMissingTicket")
            : failure(`ExpoHTTP${response.status}`);
        }
      } catch {
        for (const { index } of expo) {
          tickets[index] = failure("ExpoTransportError");
        }
      }
    })(),
    ...native.map(async ({ message, index }) => {
      tickets[index] = await sendApns(message);
    }),
  ]);
  return tickets;
}

async function sendApns(message: PushMessage): Promise<PushTicket> {
  const keyId = Deno.env.get("APNS_KEY_ID");
  const teamId = Deno.env.get("APNS_TEAM_ID");
  const privateKey = Deno.env.get("APNS_PRIVATE_KEY");
  const topic = Deno.env.get("APNS_TOPIC");
  if (!keyId || !teamId || !privateKey || !topic) {
    return failure("APNsNotConfigured");
  }

  let authorization: string;
  try {
    const now = Math.floor(Date.now() / 1000);
    if (!providerToken || now - providerToken.issuedAt >= 50 * 60) {
      const value = signToken(keyId, teamId, privateKey, now);
      providerToken = { issuedAt: now, value };
      // A failed import/sign must not poison later attempts in this isolate.
      void value.catch(() => {
        providerToken = undefined;
        signingKey = undefined;
      });
    }
    authorization = await providerToken.value;
  } catch {
    return failure("APNsSigningError");
  }

  try {
    // Deno's fetch negotiates HTTP/2 with APNs. This key covers shipping builds;
    // development tokens must never be retried against Expo or disabled as dead.
    const response = await fetch(
      APNS_PUSH_URL + encodeURIComponent(message.to.slice(5)),
      {
        method: "POST",
        headers: {
          authorization: `bearer ${authorization}`,
          "apns-topic": topic,
          "apns-push-type": "alert",
          "apns-priority": "10",
          "apns-expiration": "0",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ...message.data,
          aps: {
            alert: { title: message.title, body: message.body },
            sound: message.sound ?? "default",
          },
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (response.ok) {
      await response.body?.cancel();
      return { status: "ok" };
    }
    const payload = await response.json().catch(() => ({}));
    // BadDeviceToken may mean a sandbox token sent to production. Only Apple's
    // explicit unregister response is enough evidence to deactivate an install.
    if (
      response.status === 410 &&
      ["Unregistered", "ExpiredToken"].includes(payload?.reason)
    ) {
      return failure("DeviceNotRegistered");
    }
    return failure(`APNs:${payload?.reason ?? response.status}`);
  } catch {
    return failure("APNsTransportError");
  }
}

async function signToken(
  keyId: string,
  teamId: string,
  pem: string,
  issuedAt: number,
) {
  signingKey ??= crypto.subtle.importKey(
    "pkcs8",
    Uint8Array.from(
      atob(pem.replace(/-----[^-]+-----|\s|\\n/g, "")),
      (char) => char.charCodeAt(0),
    ),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const input = `${
    base64url(encoder.encode(JSON.stringify({ alg: "ES256", kid: keyId })))
  }.${
    base64url(encoder.encode(JSON.stringify({ iss: teamId, iat: issuedAt })))
  }`;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    await signingKey,
    encoder.encode(input),
  );
  return `${input}.${base64url(new Uint8Array(signature))}`;
}

function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(
    /\//g,
    "_",
  ).replace(/=+$/, "");
}

function failure(error: string): PushTicket {
  return { status: "error", details: { error } };
}
