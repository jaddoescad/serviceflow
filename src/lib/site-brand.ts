// Both deployments share code while their databases and branding are separate.
const serviceFlow = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") ===
  "https://bwbckdkouqghdadpkjvn.supabase.co";

export const SITE_NAME = serviceFlow ? "ServiceFlow" : "Ottawa Painters";
export const SITE_INITIALS = serviceFlow ? "SF" : "OP";
export const SITE_TITLE = serviceFlow ? "ServiceFlow" : "Ottawa Painters — Admin";
