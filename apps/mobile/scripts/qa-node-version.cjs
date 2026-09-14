#!/usr/bin/env node

const major = Number(process.versions.node.split(".")[0]);

if (major === 20 || major >= 22) {
  console.log(`Node ${process.versions.node} is supported.`);
  process.exit(0);
}

console.error(
  `Node ${process.versions.node} is not supported for deploy checks. Use Node 20 LTS or Node 22+.`,
);
process.exit(1);
