import { strict as assert } from "node:assert";
import { type PushMessage, sendPushBatch } from "./push.ts";

Deno.test("native APNs routing, signing, and failure isolation", async (test) => {
  const keys = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = new Uint8Array(
    await crypto.subtle.exportKey("pkcs8", keys.privateKey),
  );
  const pem = `-----BEGIN PRIVATE KEY-----\n${
    btoa(String.fromCharCode(...pkcs8))
  }\n-----END PRIVATE KEY-----`;
  const env = {
    APNS_KEY_ID: "TESTKEY123",
    APNS_TEAM_ID: "TESTTEAM12",
    APNS_PRIVATE_KEY: pem,
    APNS_TOPIC: "com.ottawapainters.app",
  };
  const previousEnv = Object.fromEntries(
    Object.keys(env).map((name) => [name, Deno.env.get(name)]),
  );
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  const native: PushMessage = {
    to: "apns:0123456789abcdef",
    title: "Clock in",
    body: "Time to start",
    sound: "default",
    data: { type: "daily_clock_in_reminder" },
  };
  const expo = { ...native, to: "ExponentPushToken[test]" };

  try {
    for (const [name, value] of Object.entries(env)) Deno.env.set(name, value);

    await test.step("mixed installs use their provider and preserve ticket order", async () => {
      const requests: { url: string; init: RequestInit }[] = [];
      globalThis.fetch = (input, init) => {
        requests.push({ url: String(input), init: init! });
        return Promise.resolve(
          String(input).includes("exp.host")
            ? Response.json({ data: [{ status: "ok", id: "receipt-1" }] })
            : new Response(null, { status: 200 }),
        );
      };
      assert.deepEqual(await sendPushBatch([native, expo]), [{ status: "ok" }, {
        status: "ok",
        id: "receipt-1",
      }]);
      const apns = requests.find((request) =>
        request.url.includes("push.apple.com")
      )!;
      assert.equal(
        apns.url,
        "https://api.push.apple.com/3/device/0123456789abcdef",
      );
      const headers = new Headers(apns.init.headers);
      assert.equal(headers.get("apns-topic"), env.APNS_TOPIC);
      assert.equal(headers.get("apns-push-type"), "alert");
      assert.equal(headers.get("apns-expiration"), "0");
      assert.deepEqual(JSON.parse(String(apns.init.body)), {
        type: "daily_clock_in_reminder",
        aps: {
          alert: { title: native.title, body: native.body },
          sound: "default",
        },
      });
      const token = headers.get("authorization")!.replace("bearer ", "");
      const [header, claims, signature] = token.split(".");
      const decode = (value: string) =>
        Uint8Array.from(
          atob(value.replace(/-/g, "+").replace(/_/g, "/")),
          (char) => char.charCodeAt(0),
        );
      assert.deepEqual(JSON.parse(new TextDecoder().decode(decode(header))), {
        alg: "ES256",
        kid: env.APNS_KEY_ID,
      });
      assert.equal(
        JSON.parse(new TextDecoder().decode(decode(claims))).iss,
        env.APNS_TEAM_ID,
      );
      assert.equal(
        await crypto.subtle.verify(
          { name: "ECDSA", hash: "SHA-256" },
          keys.publicKey,
          decode(signature),
          new TextEncoder().encode(`${header}.${claims}`),
        ),
        true,
      );
      assert.deepEqual(
        JSON.parse(String(
          requests.find((request) => request.url.includes("exp.host"))!.init
            .body,
        )),
        [expo],
      );
    });

    await test.step("sandbox or configuration errors never deactivate a token", async () => {
      for (
        const [status, reason] of [
          [400, "BadDeviceToken"],
          [400, "DeviceTokenNotForTopic"],
          [403, "InvalidProviderToken"],
          [429, "TooManyRequests"],
          [503, "ServiceUnavailable"],
        ] as const
      ) {
        globalThis.fetch = () =>
          Promise.resolve(Response.json({ reason }, { status }));
        assert.deepEqual(await sendPushBatch([native]), [{
          status: "error",
          details: { error: `APNs:${reason}` },
        }]);
      }
    });

    await test.step("only explicit unregister responses deactivate an install", async () => {
      for (const reason of ["Unregistered", "ExpiredToken"]) {
        globalThis.fetch = () =>
          Promise.resolve(Response.json({ reason }, { status: 410 }));
        assert.deepEqual(await sendPushBatch([native]), [{
          status: "error",
          details: { error: "DeviceNotRegistered" },
        }]);
      }
    });

    await test.step("missing APNs secrets preserve Expo delivery", async () => {
      Deno.env.delete("APNS_PRIVATE_KEY");
      globalThis.fetch = (input) => {
        assert.ok(String(input).includes("exp.host"));
        return Promise.resolve(
          Response.json({ data: [{ status: "ok", id: "receipt-2" }] }),
        );
      };
      assert.deepEqual(await sendPushBatch([native, expo]), [
        { status: "error", details: { error: "APNsNotConfigured" } },
        { status: "ok", id: "receipt-2" },
      ]);
      Deno.env.set("APNS_PRIVATE_KEY", pem);
    });

    await test.step("Expo outage does not prevent native notifications", async () => {
      globalThis.fetch = (input) => {
        if (String(input).includes("exp.host")) {
          throw new Error("network failure");
        }
        return Promise.resolve(new Response(null, { status: 200 }));
      };
      assert.deepEqual(await sendPushBatch([expo, native]), [
        { status: "error", details: { error: "ExpoTransportError" } },
        { status: "ok" },
      ]);
    });

    await test.step("network failure does not mark APNs tokens dead", async () => {
      globalThis.fetch = () => {
        throw new Error("network failure");
      };
      assert.deepEqual(await sendPushBatch([native]), [{
        status: "error",
        details: { error: "APNsTransportError" },
      }]);
    });

    await test.step("unknown native providers never reach Expo", async () => {
      globalThis.fetch = () => {
        throw new Error("must not send");
      };
      assert.deepEqual(await sendPushBatch([{ ...native, to: "fcm:token" }]), [{
        status: "error",
        details: { error: "UnsupportedPushToken" },
      }]);
    });

    await test.step("provider JWT is reused and refreshed before expiry", async () => {
      const authorizations: string[] = [];
      globalThis.fetch = (_input, init) => {
        authorizations.push(
          new Headers((init as RequestInit | undefined)?.headers).get(
            "authorization",
          )!,
        );
        return Promise.resolve(new Response(null, { status: 200 }));
      };
      await sendPushBatch([native]);
      await sendPushBatch([native]);
      assert.equal(authorizations[0], authorizations[1]);
      Date.now = () => originalNow() + 51 * 60 * 1000;
      await sendPushBatch([native]);
      assert.notEqual(authorizations[0], authorizations[2]);
    });
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
    for (const [name, value] of Object.entries(previousEnv)) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
  }
});
