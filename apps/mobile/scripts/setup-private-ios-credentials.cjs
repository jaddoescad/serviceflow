#!/usr/bin/env node

/*
 * Creates an Apple ad-hoc provisioning profile for one already-registered
 * iPhone, stores it in EAS, and assigns it to the app's AD_HOC credentials.
 * Secrets are read from the existing authenticated EAS session and are never
 * written to disk or printed.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const EAS_ROOT = "/Users/jadslim/.npm-global/lib/node_modules/eas-cli/build";
const ACCOUNT_NAME = "jaddoescad";
const PROJECT_NAME = "serviceflow";
const BUNDLE_IDENTIFIER = "com.ottawapainters.app";
const DEVICE_UDID = "00008120-001C1CE43E50A01E";

const { createGraphqlClient } = require(path.join(
  EAS_ROOT,
  "commandUtils/context/contextUtils/createGraphqlClient.js"
));
const { AppQuery } = require(path.join(EAS_ROOT, "graphql/queries/AppQuery.js"));
const { AppStoreConnectApiKeyQuery: AppStoreConnectApiKeyListQuery } = require(path.join(
  EAS_ROOT,
  "credentials/ios/api/graphql/queries/AppStoreConnectApiKeyQuery.js"
));
const { AppStoreConnectApiKeyQuery } = require(path.join(
  EAS_ROOT,
  "graphql/queries/AppStoreConnectApiKeyQuery.js"
));
const { AppleAppIdentifierQuery } = require(path.join(
  EAS_ROOT,
  "credentials/ios/api/graphql/queries/AppleAppIdentifierQuery.js"
));
const { AppleProvisioningProfileMutation } = require(path.join(
  EAS_ROOT,
  "credentials/ios/api/graphql/mutations/AppleProvisioningProfileMutation.js"
));
const iosGraphql = require(path.join(EAS_ROOT, "credentials/ios/api/GraphqlClient.js"));
const { IosDistributionType } = require(path.join(EAS_ROOT, "graphql/generated.js"));

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function createAppleJwt({ issuerIdentifier, keyIdentifier, keyP8 }) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "ES256", kid: keyIdentifier, typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({ iss: issuerIdentifier, iat: now, exp: now + 15 * 60, aud: "appstoreconnect-v1" })
  );
  const unsignedToken = `${header}.${payload}`;
  const signature = crypto.sign("sha256", Buffer.from(unsignedToken), {
    key: keyP8,
    dsaEncoding: "ieee-p1363"
  });
  return `${unsignedToken}.${signature.toString("base64url")}`;
}

async function appleRequest(token, pathname, options = {}) {
  const response = await fetch(`https://api.appstoreconnect.apple.com${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const details = body?.errors?.map((error) => error.detail || error.title).join("; ");
    throw new Error(`Apple API ${response.status} for ${pathname}: ${details || "request failed"}`);
  }
  return body;
}

async function findWorkingAppleToken(graphqlClient) {
  const keyRefs = await AppStoreConnectApiKeyListQuery.getAllForAccountAsync(
    graphqlClient,
    ACCOUNT_NAME
  );
  for (const keyRef of keyRefs) {
    const key = await AppStoreConnectApiKeyQuery.getByIdAsync(graphqlClient, keyRef.id);
    const token = createAppleJwt(key);
    try {
      await appleRequest(token, "/v1/devices?limit=1");
      return token;
    } catch (error) {
      if (!String(error.message).includes("Apple API 401") && !String(error.message).includes("Apple API 403")) {
        throw error;
      }
    }
  }
  throw new Error("No stored App Store Connect API key can manage Apple devices and profiles.");
}

async function main() {
  const easState = JSON.parse(
    fs.readFileSync("/Users/jadslim/.expo/state.json", "utf8")
  );
  const sessionSecret = easState?.auth?.sessionSecret;
  if (!sessionSecret) {
    throw new Error("No authenticated EAS session was found.");
  }

  const graphqlClient = createGraphqlClient({ sessionSecret });
  const app = await AppQuery.byFullNameAsync(graphqlClient, `@${ACCOUNT_NAME}/${PROJECT_NAME}`);
  const account = app.ownerAccount;
  const appLookupParams = {
    account,
    projectName: PROJECT_NAME,
    bundleIdentifier: BUNDLE_IDENTIFIER
  };

  const [appleAppIdentifier, distributionCertificate, appleToken] = await Promise.all([
    AppleAppIdentifierQuery.byBundleIdentifierAsync(
      graphqlClient,
      ACCOUNT_NAME,
      BUNDLE_IDENTIFIER
    ),
    iosGraphql.getDistributionCertificateForAppAsync(
      graphqlClient,
      appLookupParams,
      IosDistributionType.AppStore
    ),
    findWorkingAppleToken(graphqlClient)
  ]);

  if (!appleAppIdentifier) {
    throw new Error(`EAS has no Apple app identifier for ${BUNDLE_IDENTIFIER}.`);
  }
  if (!distributionCertificate) {
    throw new Error("EAS has no App Store distribution certificate to reuse.");
  }

  const bundleResponse = await appleRequest(
    appleToken,
    `/v1/bundleIds?filter%5Bidentifier%5D=${encodeURIComponent(BUNDLE_IDENTIFIER)}&limit=1`
  );
  const bundleId = bundleResponse.data?.[0]?.id;
  if (!bundleId) {
    throw new Error(`Apple has no bundle ID for ${BUNDLE_IDENTIFIER}.`);
  }

  const deviceResponse = await appleRequest(
    appleToken,
    `/v1/devices?filter%5Budid%5D=${encodeURIComponent(DEVICE_UDID)}&limit=1`
  );
  const appleDevice = deviceResponse.data?.[0];
  if (!appleDevice || appleDevice.attributes?.status !== "ENABLED") {
    throw new Error(`The target iPhone ${DEVICE_UDID} is not enabled in Apple Developer.`);
  }

  let appleCertificateId = distributionCertificate.developerPortalIdentifier;
  if (appleCertificateId) {
    try {
      await appleRequest(appleToken, `/v1/certificates/${appleCertificateId}`);
    } catch {
      appleCertificateId = null;
    }
  }
  if (!appleCertificateId) {
    const certificates = await appleRequest(appleToken, "/v1/certificates?limit=200");
    const matchingCertificate = certificates.data?.find(
      (certificate) => certificate.attributes?.serialNumber === distributionCertificate.serialNumber
    );
    appleCertificateId = matchingCertificate?.id;
  }
  if (!appleCertificateId) {
    throw new Error("The EAS distribution certificate could not be matched in Apple Developer.");
  }

  const profileName = `ServiceFlow Jad Private ${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const profileResponse = await appleRequest(appleToken, "/v1/profiles", {
    method: "POST",
    body: JSON.stringify({
      data: {
        type: "profiles",
        attributes: {
          name: profileName,
          profileType: "IOS_APP_ADHOC"
        },
        relationships: {
          bundleId: { data: { type: "bundleIds", id: bundleId } },
          certificates: {
            data: [{ type: "certificates", id: appleCertificateId }]
          },
          devices: {
            data: [{ type: "devices", id: appleDevice.id }]
          }
        }
      }
    })
  });

  const appleProfile = profileResponse.data;
  const profileContent = appleProfile?.attributes?.profileContent;
  if (!appleProfile?.id || !profileContent) {
    throw new Error("Apple created a profile without downloadable profile content.");
  }

  const easProfile = await AppleProvisioningProfileMutation.createAppleProvisioningProfileAsync(
    graphqlClient,
    {
      appleProvisioningProfile: profileContent,
      developerPortalIdentifier: appleProfile.id
    },
    account.id,
    appleAppIdentifier.id
  );

  await iosGraphql.createOrUpdateIosAppBuildCredentialsAsync(graphqlClient, appLookupParams, {
    appleTeam: distributionCertificate.appleTeam,
    appleAppIdentifierId: appleAppIdentifier.id,
    iosDistributionType: IosDistributionType.AdHoc,
    appleProvisioningProfileId: easProfile.id,
    appleDistributionCertificateId: distributionCertificate.id
  });

  process.stdout.write(
    `Private iOS credentials ready for ${appleDevice.attributes?.name || "target iPhone"}.\n`
  );
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
