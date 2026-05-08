"use strict";

const fs = require("fs");
const path = require("path");

const publicDataDir = path.resolve("public", "data");
const builtDataDir = path.resolve("dist", "data");

if (!fs.existsSync(publicDataDir)) {
  console.warn("No public/data directory found. The dashboard will still run, but no demo data will be bundled.");
  process.exit(0);
}

if (!fs.existsSync(builtDataDir)) {
  fs.mkdirSync(builtDataDir, { recursive: true });
}

console.log(`Using bundled safe demo data from ${publicDataDir}`);
