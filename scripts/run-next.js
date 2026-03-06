#!/usr/bin/env node
const path = require("path");
const { execSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const nextAppDir = path.join(repoRoot, "next-app");

const [,, cmd = "dev"] = process.argv;
const npmCmd = cmd === "dev" ? "run dev" : cmd === "build" ? "run build" : cmd === "start" ? "run start" : cmd === "lint" ? "run lint" : "run " + cmd;
execSync("npm " + npmCmd, { stdio: "inherit", shell: true, cwd: nextAppDir });
