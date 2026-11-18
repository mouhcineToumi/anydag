/**
 * One runner at a time, for the scripts the maintainer leaves running in the background — the merge
 * queue (#503) and the visual review (#528): a file holding the runner's pid, taken over when that
 * process is gone, and removed when this one exits.
 */
import fs from "node:fs";

/** Takes the lock at `file`, or says who holds it and exits 1. */
export function lock(file, say) {
  try {
    const pid = Number(fs.readFileSync(file, "utf8"));
    process.kill(pid, 0);
    say(`already running (pid ${pid})`);
    process.exit(1);
  } catch {
    /* no lock, or its runner is gone */
  }
  fs.writeFileSync(file, String(process.pid));
  process.on("exit", () => fs.rmSync(file, { force: true }));
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(130));
}
