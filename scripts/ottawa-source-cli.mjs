#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSourceRequest, fetchSource } from "./lib/ottawa-read-sources.mjs";

const HELP = `Ottawa Painters allowlisted, GET-only external sources

Usage:
  ottawa-source quo phone-numbers
  ottawa-source quo messages --phone-number-id PN... --participant +16135551234 [--limit 50]
  ottawa-source companycam project <project-id>
  ottawa-source companycam photos <project-id> [--limit 50] [--after <cursor>]

Required secrets stay in QUO_API_KEY and COMPANYCAM_API_KEY. This executable has
no arbitrary URL option and implements no POST, PUT, PATCH, or DELETE requests.`;

export async function run(argv) {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  try {
    const request = buildSourceRequest(argv);
    const result = await fetchSource(request);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`Error: ${error.message}\n`);
    return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exitCode = await run(process.argv.slice(2));
}
