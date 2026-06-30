#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { main } from "../src/cli.mjs";

const entrypoint = fileURLToPath(import.meta.url);

main(process.argv.slice(2), { entrypoint }).catch((error) => {
  const isClientError = error?.cliUsage || (Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode < 500);
  if (isClientError) {
    console.error(`Error: ${error?.message || String(error)}`);
  } else {
    console.error(error?.stack || String(error));
  }
  process.exitCode = Number.isInteger(error?.exitCode) ? error.exitCode : 1;
});
