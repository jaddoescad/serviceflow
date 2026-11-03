// A DSN is a public ingestion address, not an API token.
export const sentryDsn = process.env.NEXT_PUBLIC_SENTRY_DSN ??
  "https://e604788374e18752426f5d7afaa6db99@o4511039040061440.ingest.us.sentry.io/4512368331063296";

export const sentryOptions = {
  dsn: sentryDsn,
  enabled: process.env.NODE_ENV === "production" && Boolean(sentryDsn),
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
  sendDefaultPii: false,
  // Error monitoring only; don't collect session recordings or performance traces.
  tracesSampleRate: 0,
  enableLogs: false,
};
