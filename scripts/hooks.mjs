#!/usr/bin/env node
/**
 * `npm run prepare`, which `npm install` and `npm ci` both run: point git at `.githooks/` —
 * relative, so one setting serves every worktree. It does nothing where there is no git or no
 * repository (`npm ci` in a tarball), and it is Node rather than a shell line because npm runs
 * scripts with `cmd.exe` on Windows, where `command -v` and `true` do not exist.
 */
import { spawnSync } from "node:child_process";

const inside = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { stdio: "ignore" });
if (inside.status === 0) spawnSync("git", ["config", "core.hooksPath", ".githooks"], { stdio: "ignore" });
