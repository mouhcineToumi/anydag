import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { HUE_ORDER } from "@/dsl/ir";
import { splitNote } from "@/note/format";
import {
  folderTitle,
  PROJECT_STATUSES,
  projectFolders,
  projectFor,
  projectOf,
  projectText,
  within,
  withProject,
  type Project,
  type ProjectChange,
} from "@/note/project";
import { taskOf } from "@/note/task";

/**
 * What makes a folder a project.
 *
 * A project is a note with a `project:`, and the folder it sits in is the project. The server, the
 * page and the CLI read it here, and work out who belongs to what from the names, held to
 * `test/fixtures/projects.json`.
 */
const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "projects.json"), "utf8")) as {
  hues: string[];
  read: { why: string; text: string; project: Project | null }[];
  write: { why: string; text: string; set: ProjectChange; out: string }[];
};

describe("reading a project", () => {
  it.each(FIXTURE.read.map((c) => [c.why, c] as const))("%s", (_, c) => {
    expect(projectOf(c.text) ?? null).toEqual(c.project);
  });

  it("knows the ten hues the fixture holds the api to", () => {
    expect([...HUE_ORDER]).toEqual(FIXTURE.hues);
  });
});

describe("writing a project", () => {
  it.each(FIXTURE.write.map((c) => [c.why, c] as const))("%s", (_, c) => {
    expect(withProject(c.text, c.set)).toBe(c.out);
  });

  it("writes what it reads back, for every status, with and without a colour", () => {
    for (const status of PROJECT_STATUSES) {
      for (const hue of [undefined, "coral"]) {
        const text = withProject("---\ntitle: P\n---\nbody\n", { project: status, hue: hue ?? null });
        expect(projectOf(text)).toEqual(hue ? { status, hue } : { status });
        expect(splitNote(text).body).toBe("body\n");
        expect(splitNote(text).title).toBe("P");
      }
    }
  });

  it("makes what Make it a project writes: a titled note that is a project and not a task", () => {
    const text = projectText("Pricing relaunch");
    expect(projectOf(text)).toEqual({ status: "active" });
    expect(taskOf(text)).toBeUndefined();
    expect(splitNote(text).title).toBe("Pricing relaunch");
    expect(splitNote(projectText('He said "go": now')).title).toBe('He said "go": now');
  });
});

describe("membership", () => {
  const projects: Record<string, Project> = {
    "work/pricing/pricing": { status: "active" },
    "work/pricing/research/research": { status: "paused" },
    /* A second project note in one folder: the first by name owns it. */
    "work/pricing/zz-other": { status: "active" },
    /* At the top level a project note has no folder and holds nothing. */
    loose: { status: "active" },
  };
  const folders = projectFolders(projects);

  it("maps each folder to the project note directly in it, the first by name", () => {
    expect([...folders.entries()].sort()).toEqual([
      ["work/pricing", "work/pricing/pricing"],
      ["work/pricing/research", "work/pricing/research/research"],
    ]);
  });

  it("names a document by its innermost project", () => {
    expect(projectFor("work/pricing/copy", folders)).toBe("work/pricing/pricing");
    expect(projectFor("work/pricing/deep/down/board", folders)).toBe("work/pricing/pricing");
    expect(projectFor("work/pricing/research/interviews", folders)).toBe("work/pricing/research/research");
    /* A project's own note is in its own project. */
    expect(projectFor("work/pricing/pricing", folders)).toBe("work/pricing/pricing");
    expect(projectFor("work/pricing/zz-other", folders)).toBe("work/pricing/pricing");
  });

  it("names nothing outside every project", () => {
    expect(projectFor("work/other", folders)).toBeUndefined();
    expect(projectFor("loose", folders)).toBeUndefined();
    expect(projectFor("top", folders)).toBeUndefined();
    /* A prefix of a folder's name is not the folder. */
    expect(projectFor("work/pricing-old/copy", folders)).toBeUndefined();
  });

  it("counts everything under a folder as inside it, nested projects included", () => {
    expect(within("work/pricing/research/interviews", "work/pricing")).toBe(true);
    expect(within("work/pricing-old/copy", "work/pricing")).toBe(false);
    expect(within("work/pricing", "work/pricing")).toBe(false);
    expect(within("anything", "")).toBe(false);
  });

  it("titles a folder's project after the folder", () => {
    expect(folderTitle("work/pricing-relaunch")).toBe("Pricing relaunch");
    expect(folderTitle("q3_launch")).toBe("Q3 launch");
    expect(folderTitle("---")).toBe("Project");
  });
});
