import * as lucide from "lucide-react";
import { describe, expect, it } from "vitest";

import { modeOf, searchAcross, searchIcons, writtenFor, PREVIEW_CAP, type PickMode } from "@/edit/IconPicker";
import { ICON_NAMES } from "@/dsl/icon-names";
import { iconFor } from "@/render/Icon";
import type { NodeKind } from "@/dsl/ir";
import { THEMES } from "@/theme/useTheme";

/**
 * The picker's arithmetic, which is the part a person's pick and a written value both depend on.
 *
 * The three mode lists are where a second copy of the truth could creep in: membership is read off
 * `icons/data/icons.json`, the previews are drawn by `iconFor()`, and the written strings have to
 * be legal the way `finalize()` reads them — prefixed spellings included. So the tests hold all
 * three to the two authorities: the bundle for membership, `iconFor` for what a candidate draws.
 */

const theme = THEMES[Object.keys(THEMES)[0] ?? ""]!;

/* The picker never imports the barrel for lookup — this is the test's independent way of saying
   the same thing about a name, through the barrel `Icon` itself uses. */
const pascalOf = (name: string): string => name.replace(/(^|[-_])([a-z])/g, (_, __, c: string) => c.toUpperCase());

describe("the mode lists", () => {
  it("cover the vocabulary between them, mono sitting inside brand", () => {
    const brand = searchIcons("", "brand");
    const mono = searchIcons("", "mono");
    const concept = searchIcons("", "lucide");
    const emoji = searchIcons("", "emoji");
    expect(new Set([...brand, ...concept, ...emoji]).size).toBe(ICON_NAMES.size);
    expect(mono.every((n) => brand.includes(n))).toBe(true);
    /* The pictures are their own list, and nothing else is in it. */
    expect(emoji.length).toBeGreaterThan(1500);
    expect(emoji.every((n) => n.startsWith("emoji:"))).toBe(true);
    expect(brand.some((n) => n.startsWith("emoji:"))).toBe(false);
  });

  it("finds a picture by the word a person types, the namespace aside", () => {
    expect(searchIcons("house", "emoji")[0]).toBe("emoji:house");
    expect(searchIcons("book", "emoji")).toContain("emoji:closed-book");
    expect(searchIcons("emoji:rocket", "emoji")).toContain("emoji:rocket");
  });

  it("offers the concept glyph for a name a brand also claims", () => {
    /*
     * The three lists are deliberately *not* a partition, and asserting they were is what hid a
     * real defect: the names both vocabularies claim sit in the bundle as well as in Lucide, so a
     * concept list built by subtracting the bundle dropped exactly them — and they are the only
     * names for which `lucide:` is the sole route to the glyph. Since `snowflake` became a brand,
     * nothing else can ask for the weather.
     *
     * Frozen rather than derived, for the reason `check-icons.mjs` prints the same set on every
     * run: a seventh name arriving means some board's concept glyph has silently become a logo,
     * and that is worth being told about. Updating this list is the deliberate acknowledgement.
     */
    const both = searchIcons("", "brand").filter((n) => searchIcons("", "lucide").includes(n));
    expect(both).toEqual(["figma", "github", "gitlab", "slack", "snowflake", "vault"]);
    expect(writtenFor("lucide", "github")).toBe("lucide:github");
  });

  it("puts the two real boards' missing icons where a search will find them", () => {
    /* `icon=layers` stood for dbt and `icon=database` for Redis because neither name was findable.
       A search matches the *name*, so an alias (`pg`) is found by its own word, not its target's. */
    expect(searchIcons("dbt", "brand")).toContain("dbt");
    expect(searchIcons("redis", "brand")).toContain("redis");
    expect(searchIcons("postgres", "brand")).toContain("postgresql");
    expect(searchIcons("pg", "brand")).toContain("pg");
  });

  it("matches every token, in any order", () => {
    expect(searchIcons("arrow down", "lucide")).toContain("arrow-down");
    expect(searchIcons("down arrow", "lucide")).toContain("arrow-down");
  });

  it("puts a starts-with match ahead of a later one", () => {
    expect(searchIcons("ser", "lucide")[0]).toBe("server");
    /* Both the alias and its target start with the query; the alphabet settles between equals. */
    expect(["postgres", "postgresql"]).toContain(searchIcons("post", "brand")[0]);
  });

  it("is every name when there is no query", () => {
    expect(searchIcons("", "brand")).toEqual([...searchIcons("", "brand")].sort());
  });
});

describe("writtenFor", () => {
  it("writes the real DSL string for each mode", () => {
    expect(writtenFor("brand", "postgresql")).toBe("postgresql");
    expect(writtenFor("mono", "postgresql")).toBe("mono:postgresql");
    expect(writtenFor("lucide", "server")).toBe("lucide:server");
    expect(writtenFor("emoji", "emoji:house")).toBe("emoji:house");
    expect(writtenFor("emoji", "emoji:house", true)).toBe("mono:emoji:house");
  });

  it("writes only values the parser accepts, prefixed spellings included", () => {
    /* `finalize()` strips `mono:`/`lucide:` and checks the bare name against `ICON_NAMES`. */
    const bare = (written: string): string => written.replace(/^(?:mono|lucide):/, "");
    for (const mode of ["brand", "mono", "lucide", "emoji"] as PickMode[]) {
      for (const name of searchIcons("", mode)) {
        expect(ICON_NAMES.has(bare(writtenFor(mode, name))), `${mode} ${name}`).toBe(true);
      }
    }
  });
});

describe("modeOf", () => {
  it("reads the prefix off the value", () => {
    expect(modeOf("mono:postgresql")).toBe("mono");
    expect(modeOf("lucide:server")).toBe("lucide");
  });

  it("resolves an unprefixed name the way the card will", () => {
    expect(modeOf("postgresql")).toBe("brand");
    expect(modeOf("redis")).toBe("brand");
    expect(modeOf("database")).toBe("lucide");
  });

  it("opens on the pictures for an emoji, and for a figure with none yet", () => {
    expect(modeOf("emoji:house")).toBe("emoji");
    expect(modeOf("mono:emoji:house")).toBe("emoji");
    expect(modeOf("", "figure")).toBe("emoji");
    expect(modeOf("", "service")).toBe("brand");
  });

  it("opens on brand for anything it cannot place", () => {
    expect(modeOf("not-an-icon")).toBe("brand");
    expect(modeOf("")).toBe("brand");
  });
});

describe("what a candidate draws, through iconFor", () => {
  it("brand candidates resolve to the logo, never to the kind's fallback", () => {
    const fallback = iconFor("service" as NodeKind, theme);
    for (const name of searchIcons("", "brand")) {
      const ref = iconFor("service" as NodeKind, theme, writtenFor("brand", name));
      expect(ref.mode === "brand" || ref.mode === "mono", name).toBe(true);
      expect(ref).not.toEqual(fallback);
    }
  });

  it("mono candidates resolve as silhouettes", () => {
    for (const name of searchIcons("", "mono")) {
      expect(iconFor("service" as NodeKind, theme, writtenFor("mono", name)).mode, name).toBe("mono");
    }
  });

  it("lucide candidates are in the barrel the renderer reads", () => {
    for (const name of searchIcons("", "lucide")) {
      expect(lucide[pascalOf(name) as keyof typeof lucide], name).toBeTruthy();
    }
  });
});

describe("the cap", () => {
  it("is small enough to mount and smaller than what a query can return", () => {
    expect(PREVIEW_CAP).toBeGreaterThan(0);
    expect(PREVIEW_CAP).toBeLessThanOrEqual(120);
    expect(searchIcons("", "lucide").length).toBeGreaterThan(PREVIEW_CAP);
  });
});

describe("a chip never hides a name that exists", () => {
  /*
   * The defect this freezes was visible in a browser and invisible to every unit test: the picker
   * opens in the mode the *current value* implies, so a `service` card wearing Lucide's `server`
   * opened on Lucide, and "postgres" there reported nothing while the elephant sat one chip away.
   * That is the failure the whole issue was opened for — an author concluding the icon does not
   * ship — reproduced by the tool meant to cure it.
   */
  it("answers from another mode when the active one has nothing", () => {
    const found = searchAcross("postgres", "lucide");
    expect(found.fellBack).toBe(true);
    expect(found.mode).toBe("brand");
    expect(found.names).toContain("postgresql");
  });

  it("writes the fallback mode's spelling, not the chip the person never touched", () => {
    const found = searchAcross("postgres", "lucide");
    expect(writtenFor(found.mode, "postgresql")).toBe("postgresql");
  });

  it("leaves a mode that has its own hits alone", () => {
    const found = searchAcross("server", "lucide");
    expect(found.fellBack).toBe(false);
    expect(found.mode).toBe("lucide");
    expect(found.names).toContain("server");
  });

  it("stands on the declared mode when there is no query to disagree with", () => {
    for (const m of ["brand", "mono", "lucide"] as PickMode[]) {
      const found = searchAcross("", m);
      expect(found.fellBack).toBe(false);
      expect(found.mode).toBe(m);
      expect(found.names).toEqual(searchIcons("", m));
    }
  });

  it("still reports nothing when a name really is absent everywhere", () => {
    const found = searchAcross("zzzznope", "lucide");
    expect(found.names).toEqual([]);
    expect(found.fellBack).toBe(false);
  });

  it("finds every data-stack name the issue named, from any chip", () => {
    for (const name of ["dbt", "snowflake", "databricks", "tableau", "looker", "metabase"]) {
      expect(searchAcross(name, "lucide").names, name).toContain(name);
    }
  });
});
