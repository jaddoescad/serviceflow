import { cache } from "react";
import { getCompanySettings } from "@/lib/actions/settings";

/** The company's settings, read once per request however many parts of the page ask. */
export const loadCompanySettings = cache(() => getCompanySettings());
