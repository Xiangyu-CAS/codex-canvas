#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { main } from "../src/cli.mjs";

const entrypoint = fileURLToPath(import.meta.url);

main(process.argv.slice(2), { entrypoint }).catch((error) => {
  console.error(error?.stack || String(error));
  process.exitCode = 1;
});
