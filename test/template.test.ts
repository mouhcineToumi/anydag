import { describe, expect, it } from "vitest";

import { STARTERS } from "@/note/starters";
import { cleanFolder, fillTemplate, formatWall, inTemplates } from "@/note/template";
import { taskOf } from "@/note/task";
import { eventOf } from "@/note/event";
import { wallOf } from "@/note/zone";

/* 2026-11-14 23:30 UTC: already the 15th in Tokyo, still the 14th in New York. */
const AT = Date.UTC(2026, 10, 14, 23, 30, 5);
const vars = (zone = "UTC", title = "Plan") => ({ title, at: AT, zone });

describe("fillTemplate", () => {
  it("fills the four variables", () => {
    expect(fillTemplate("{{title}} on {{date}} at {{time}}", vars())).toBe("Plan on 2026-11-14 at 23:30");
    expect(fillTemplate("{{date:D MMMM YYYY}}", vars())).toBe("14 November 2026");
  });

  it("leaves unknown variables exactly as written", () => {
    const text = "{{note}} {{ Title }} {{date:}} {{title:x}} {{time:HH}} {{{x}}} {{";
    expect(fillTemplate(text, vars())).toBe(text);
  });

  it("allows blanks inside the braces", () => {
    expect(fillTemplate("{{ title }}|{{ date }}|{{ date: YYYY }}", vars())).toBe("Plan|2026-11-14|2026");
  });

  it("fills once: a title that says {{date}} is not filled again", () => {
    expect(fillTemplate("# {{title}}", vars("UTC", "About {{date}}"))).toBe("# About {{date}}");
  });

  it("reads the day and the clock in the zone it is given", () => {
    expect(fillTemplate("{{date}} {{time}}", vars("Asia/Tokyo"))).toBe("2026-11-15 08:30");
    expect(fillTemplate("{{date}} {{time}}", vars("America/New_York"))).toBe("2026-11-14 18:30");
  });

  it("follows a zone's clock change, not a fixed offset", () => {
    const summer = { title: "", at: Date.UTC(2026, 6, 1, 12, 0), zone: "Europe/Paris" };
    const winter = { title: "", at: Date.UTC(2026, 0, 1, 12, 0), zone: "Europe/Paris" };
    expect(fillTemplate("{{time}}", summer)).toBe("14:00");
    expect(fillTemplate("{{time}}", winter)).toBe("13:00");
  });

  it("leaves every other byte alone, line endings included", () => {
    const text = "---\r\ntitle: x\r\n---\r\n\r\n| a |\r\n|---|\r\n  {{date}}  \r\n";
    expect(fillTemplate(text, vars())).toBe("---\r\ntitle: x\r\n---\r\n\r\n| a |\r\n|---|\r\n  2026-11-14  \r\n");
  });

  it("keeps the frontmatter a string when the title has to be quoted", () => {
    const out = fillTemplate("---\ntitle: {{title}}\n---\nbody {{title}}", vars("UTC", "Plan: Q4 #1"));
    expect(out).toBe('---\ntitle: "Plan: Q4 #1"\n---\nbody Plan: Q4 #1');
  });

  it("escapes inside a quoted value", () => {
    expect(fillTemplate('---\ntitle: "Re {{title}}"\n---\n', vars("UTC", 'say "hi" \\ now'))).toBe(
      '---\ntitle: "Re say \\"hi\\" \\\\ now"\n---\n',
    );
    expect(fillTemplate("---\ntitle: 'Re {{title}}'\n---\n", vars("UTC", "it's"))).toBe("---\ntitle: 'Re it''s'\n---\n");
  });

  it("keeps a title that reads as a number a string", () => {
    expect(fillTemplate("---\ntitle: {{title}}\n---\n", vars("UTC", "2026"))).toBe('---\ntitle: "2026"\n---\n');
  });

  it("leaves a date or a number the template asked for as it is", () => {
    expect(fillTemplate("---\ndue: {{date}}\nyear: {{date:YYYY}}\n---\n", vars())).toBe(
      "---\ndue: 2026-11-14\nyear: 2026\n---\n",
    );
  });

  it("makes a task or an event when the template carries the line", () => {
    const task = fillTemplate("---\nstatus: todo\ndue: {{date:YYYY-MM-DD}}\n---\n# {{title}}\n", vars());
    expect(taskOf(task)).toEqual({ status: "todo", due: "2026-11-14" });
    const event = fillTemplate("---\nstart: {{date}}\n---\n", vars());
    expect(eventOf(event)).toEqual({ start: "2026-11-14" });
  });

  it("is a function of its arguments", () => {
    const text = "{{title}} {{date}} {{time}}";
    expect(fillTemplate(text, vars())).toBe(fillTemplate(text, vars()));
  });
});

describe("formatWall", () => {
  const wall = wallOf(Date.UTC(2026, 2, 5, 15, 7, 9), "UTC");
  it("writes each token", () => {
    expect(formatWall(wall, "YYYY YY MMMM MMM MM M DD D")).toBe("2026 26 March Mar 03 3 05 5");
    expect(formatWall(wall, "dddd ddd")).toBe("Thursday Thu");
    expect(formatWall(wall, "HH:mm:ss H:m:s")).toBe("15:07:09 15:7:9");
    expect(formatWall(wall, "hh h A a")).toBe("03 3 PM pm");
  });
  it("reads midnight and noon on a twelve-hour clock", () => {
    expect(formatWall(wallOf(Date.UTC(2026, 0, 1, 0, 0), "UTC"), "h A")).toBe("12 AM");
    expect(formatWall(wallOf(Date.UTC(2026, 0, 1, 12, 0), "UTC"), "h A")).toBe("12 PM");
  });
  it("copies bracketed text and unknown characters", () => {
    expect(formatWall(wall, "[Week of] D/M — YYYY")).toBe("Week of 5/3 — 2026");
  });
});

describe("inTemplates", () => {
  it("is a whole path segment, subfolders included", () => {
    expect(inTemplates("Templates/Meeting", "Templates")).toBe(true);
    expect(inTemplates("Templates/a/b", "Templates")).toBe(true);
    expect(inTemplates("Templates 2/x", "Templates")).toBe(false);
    expect(inTemplates("Templates", "Templates")).toBe(false);
    expect(inTemplates("x/Templates/y", "Templates")).toBe(false);
  });
  it("is nothing when there is no folder", () => {
    expect(inTemplates("Templates/x", null)).toBe(false);
    expect(inTemplates("Templates/x", "")).toBe(false);
  });
  it("reads a folder with its slashes taken off", () => {
    expect(cleanFolder(" /Notes/Templates/ ")).toBe("Notes/Templates");
  });
});

describe("the starters", () => {
  it("fill into notes that are neither a task nor an event", () => {
    for (const s of STARTERS) {
      const out = fillTemplate(s.text, vars());
      expect(out).not.toContain("{{");
      expect(taskOf(out)).toBeUndefined();
      expect(eventOf(out)).toBeUndefined();
    }
  });
});
