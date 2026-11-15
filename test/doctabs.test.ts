import { describe, expect, it } from "vitest";

import {
  CLOSED_LIMIT,
  activate,
  activeTab,
  addressOf,
  adopt,
  closeOthers,
  closeTab,
  fileOf,
  holding,
  identity,
  kindOf,
  moveTab,
  newTabId,
  nth,
  openTab,
  placeOf,
  reopen,
  setPlace,
  single,
  stepFrom,
  tabLabel,
  type Closed,
  type Tabs,
} from "@/ui/tabs/model";

/**
 * The document tabs (#264) as data: what a tab holds, and every change the strip, the shortcuts and
 * the address make to the set — without a browser.
 */

const three = (): Tabs => ({
  list: [
    { id: "ta", place: "board=plan" },
    { id: "tb", place: "note=ideas" },
    { id: "tc", place: "tasks=1" },
  ],
  active: "tb",
  closed: [],
});

describe("a place", () => {
  it("is the page half of an address, in one order", () => {
    expect(placeOf(new URLSearchParams("vault=v1&page=p2&board=plan&theme=paper"))).toBe("board=plan&page=p2");
    expect(placeOf("note=a%2Fb&snapshot=1")).toBe("note=a%2Fb");
    expect(placeOf("vault=v1")).toBe("");
  });

  it("keeps a reference on its way to being resolved", () => {
    expect(placeOf("ref=abc&vault=v")).toBe("ref=abc");
  });

  it("is drawn under the window's own keys", () => {
    const q = addressOf("note=ideas", "vault=v1&board=plan&page=p2&theme=dark");
    expect(q.get("vault")).toBe("v1");
    expect(q.get("theme")).toBe("dark");
    expect(q.get("note")).toBe("ideas");
    expect(q.get("board")).toBeNull();
    expect(q.get("page")).toBeNull();
  });

  it("says which page it draws, by the order the app reads an address", () => {
    expect(kindOf("")).toBe("home");
    expect(kindOf("board=plan&page=p2")).toBe("board");
    expect(kindOf("note=ideas")).toBe("note");
    expect(kindOf("quiz=q")).toBe("quiz");
    expect(kindOf("table=t&tab=x")).toBe("table");
    expect(kindOf("file=a.pdf")).toBe("file");
    expect(kindOf("tasks=1&project=p")).toBe("tasks");
    expect(kindOf("calendar=week")).toBe("calendar");
    expect(kindOf("quizzes=1&run=mistakes")).toBe("quizzes");
    expect(kindOf("trash=1")).toBe("trash");
    expect(kindOf("chat=new")).toBe("assistant");
    /* A listing page wins over a file, as `App` reads it. */
    expect(kindOf("tasks=1&note=x")).toBe("tasks");
  });

  it("names its file", () => {
    expect(fileOf("note=work%2Fideas")).toEqual({ kind: "note", name: "work/ideas" });
    expect(fileOf("tasks=1")).toBeNull();
    expect(fileOf("")).toBeNull();
  });

  it("is one tab per document or page, and Home is never shared", () => {
    expect(identity("board=plan&page=p2")).toBe(identity("board=plan"));
    expect(identity("calendar=week&date=2026-01-01")).toBe(identity("calendar=1"));
    expect(identity("")).toBeNull();
    expect(identity("note=plan")).not.toBe(identity("board=plan"));
  });

  it("is called by the file's title, else the last part of its name, or the page's name", () => {
    expect(tabLabel("note=work%2Fideas", {})).toBe("ideas");
    expect(tabLabel("note=work%2Fideas", { "work/ideas": "Ideas for Q3" })).toBe("Ideas for Q3");
    expect(tabLabel("calendar=1", {})).toBe("Calendar");
    expect(tabLabel("", {})).toBe("Home");
  });
});

describe("the tabs", () => {
  it("start as one, in front", () => {
    const t = single("board=plan", "tz");
    expect(t.list).toEqual([{ id: "tz", place: "board=plan" }]);
    expect(activeTab(t).id).toBe("tz");
  });

  it("make ids no two tabs share", () => {
    const ids = new Set(Array.from({ length: 200 }, newTabId));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^t[0-9a-f]{12}$/);
  });

  it("find the tab already holding a document, but not the one asking", () => {
    const t = three();
    expect(holding(t, "board=plan&page=p3")?.id).toBe("ta");
    expect(holding(t, "board=plan", "ta")).toBeUndefined();
    expect(holding(t, "")).toBeUndefined();
  });

  it("open a new tab after the one in front, and bring it forward", () => {
    const t = openTab(three(), "note=more", "tn");
    expect(t.list.map((x) => x.id)).toEqual(["ta", "tb", "tn", "tc"]);
    expect(t.active).toBe("tn");
  });

  it("let the entry's tab take the address and come to the front", () => {
    const t = adopt(three(), "ta", "board=other");
    expect(t.active).toBe("ta");
    expect(t.list[0]).toEqual({ id: "ta", place: "board=other" });
  });

  it("give an entry no tab holds to the tab in front: Back never makes a tab", () => {
    const t = adopt(three(), "t000000000000", "board=old");
    expect(t.list).toHaveLength(3);
    expect(t.active).toBe("tb");
    expect(activeTab(t).place).toBe("board=old");
  });

  it("are the same object when nothing changed, so nothing is drawn again", () => {
    const t = three();
    expect(adopt(t, "tb", "note=ideas")).toBe(t);
    expect(setPlace(t, "tb", "note=ideas")).toBe(t);
    expect(activate(t, "tb")).toBe(t);
    expect(activate(t, "nope")).toBe(t);
    expect(moveTab(t, "tb", 1)).toBe(t);
  });

  it("close: the front tab gives the window to its right-hand neighbour, or its left at the end", () => {
    const mid = closeTab(three(), "tb");
    expect(mid.list.map((x) => x.id)).toEqual(["ta", "tc"]);
    expect(mid.active).toBe("tc");
    const end = closeTab({ ...three(), active: "tc" }, "tc");
    expect(end.active).toBe("tb");
    const other = closeTab(three(), "ta");
    expect(other.active).toBe("tb");
  });

  it("never close the last tab: it becomes Home", () => {
    const t = closeTab(single("note=x", "tx"), "tx", "th");
    expect(t.list).toEqual([{ id: "th", place: "" }]);
    expect(t.active).toBe("th");
    expect(t.closed.map((c) => c.tab.id)).toEqual(["tx"]);
  });

  it("close the others, every one of which can come back", () => {
    const t = closeOthers(three(), "tc");
    expect(t.list.map((x) => x.id)).toEqual(["tc"]);
    expect(t.active).toBe("tc");
    expect(t.closed.map((c) => c.tab.id)).toEqual(["ta", "tb"]);
  });

  it("reopen the last closed tab where it was, in front", () => {
    const closed = closeTab(three(), "ta");
    const back = reopen(closed);
    expect(back.list.map((x) => x.id)).toEqual(["ta", "tb", "tc"]);
    expect(back.active).toBe("ta");
    expect(back.closed).toEqual([]);
    expect(reopen(back)).toBe(back);
  });

  it("reopen to the tab that holds the document by now, rather than open it twice", () => {
    let t = closeTab(three(), "ta");
    t = openTab(t, "board=plan", "tq");
    const back = reopen(t);
    expect(back.list).toHaveLength(3);
    expect(back.active).toBe("tq");
  });

  it("reopen in place of a Home nobody used", () => {
    const t = reopen(closeTab(single("note=x", "tx"), "tx", "th"));
    expect(t.list).toEqual([{ id: "tx", place: "note=x" }]);
  });

  it("remember a closed Home as nothing, and only the last few", () => {
    let t: Tabs = { list: [{ id: "th", place: "" }, ...three().list], active: "th", closed: [] };
    t = closeTab(t, "th");
    expect(t.closed).toEqual([]);
    const many: Closed[] = Array.from({ length: CLOSED_LIMIT + 5 }, (_, i) => ({
      tab: { id: `t${i}aaaaaa`, place: `note=n${i}` },
      at: 0,
    }));
    t = closeTab({ ...three(), closed: many }, "ta");
    expect(t.closed).toHaveLength(CLOSED_LIMIT);
    expect(t.closed[t.closed.length - 1]!.tab.id).toBe("ta");
  });

  it("move a tab to a position, clamped to the ends", () => {
    expect(moveTab(three(), "ta", 2).list.map((x) => x.id)).toEqual(["tb", "tc", "ta"]);
    expect(moveTab(three(), "tc", -4).list.map((x) => x.id)).toEqual(["tc", "ta", "tb"]);
    expect(moveTab(three(), "nope", 0).list.map((x) => x.id)).toEqual(["ta", "tb", "tc"]);
  });

  it("step round the ends, as Ctrl+Tab does", () => {
    expect(stepFrom(three(), 1).id).toBe("tc");
    expect(stepFrom({ ...three(), active: "tc" }, 1).id).toBe("ta");
    expect(stepFrom({ ...three(), active: "ta" }, -1).id).toBe("tc");
  });

  it("take a digit as a browser does: 1 to 8 by position, 9 the last", () => {
    expect(nth(three(), 1)?.id).toBe("ta");
    expect(nth(three(), 3)?.id).toBe("tc");
    expect(nth(three(), 5)).toBeUndefined();
    expect(nth(three(), 9)?.id).toBe("tc");
  });
});
