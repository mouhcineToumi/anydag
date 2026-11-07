import { describe, expect, it } from "vitest";

import { appendLink, connectable, connectSvg, handleAt, linkStatement, removeLinkLine } from "@/edit/connect";

/**
 * Drawing a link with the pointer, minus the pointer.
 *
 * `targetAt` is left to the e2e suite: it is two `closest()` calls over a real page, and a fake DOM
 * proving it walks a fake tree would prove nothing about the tree it actually walks.
 */

describe("linkStatement", () => {
  it("writes an item, and a node inside one", () => {
    expect(linkStatement({ item: "a" }, { item: "b" })).toBe("a --> b");
    expect(linkStatement({ item: "a" }, { item: "d", node: "db" })).toBe("a --> d.db");
    expect(linkStatement({ item: "d", node: "web" }, { item: "d2", node: "api" })).toBe("d.web --> d2.api");
  });
});

describe("appendLink", () => {
  it("starts an empty fence without a leading blank line", () => {
    expect(appendLink("", "a --> b")).toBe("a --> b");
    expect(appendLink("\n \n", "a --> b")).toBe("a --> b");
  });

  it("adds a line to a fence that already says something", () => {
    expect(appendLink("a --> b", "b --> c")).toBe("a --> b\nb --> c");
    expect(appendLink("a --> b\n\n", "b --> c")).toBe("a --> b\nb --> c");
  });
});

describe("removeLinkLine", () => {
  const body = "a --> b\nb --> c\nc --> d";

  it("takes the line it is given, and nothing else", () => {
    expect(removeLinkLine(body, 1)).toBe("b --> c\nc --> d");
    expect(removeLinkLine(body, 2)).toBe("a --> b\nc --> d");
    expect(removeLinkLine(body, 3)).toBe("a --> b\nb --> c");
  });

  it("leaves a body alone when the line is not in it", () => {
    expect(removeLinkLine(body, 0)).toBe(body);
    expect(removeLinkLine(body, 4)).toBe(body);
  });

  it("empties a fence rather than leaving it full of blank lines", () => {
    expect(removeLinkLine("a --> b", 1)).toBe("");
    expect(removeLinkLine("\na --> b\n", 2)).toBe("");
  });
});

describe("connectable", () => {
  it("refuses an item to itself, and a card to itself", () => {
    expect(connectable({ item: "a" }, { item: "a" })).toBe(false);
    expect(connectable({ item: "d", node: "db" }, { item: "d", node: "db" })).toBe(false);
  });

  it("allows two items, and two cards in one diagram", () => {
    expect(connectable({ item: "a" }, { item: "b" })).toBe(true);
    expect(connectable({ item: "d", node: "web" }, { item: "d", node: "db" })).toBe(true);
  });
});

describe("handleAt", () => {
  const box = { x: 100, y: 200, w: 300, h: 80 };

  it("sits on the middle of the side it names", () => {
    expect(handleAt(box, "n")).toEqual({ x: 250, y: 200 });
    expect(handleAt(box, "s")).toEqual({ x: 250, y: 280 });
    expect(handleAt(box, "e")).toEqual({ x: 400, y: 240 });
    expect(handleAt(box, "w")).toEqual({ x: 100, y: 240 });
  });
});

describe("connectSvg", () => {
  it("leaves the handle along its own side's normal", () => {
    const svg = connectSvg({ x: 0, y: 0 }, { x: 400, y: 0 }, "e", false, 4);
    /* The first control point is 160 to the right — the reach, capped — and level with the start. */
    expect(svg).toContain("C160,0");
    expect(svg).toContain('class="dag-connect"');
  });

  it("marks the end when it is over something it can land on", () => {
    expect(connectSvg({ x: 0, y: 0 }, { x: 10, y: 10 }, "e", false, 4)).not.toContain("--over");
    expect(connectSvg({ x: 0, y: 0 }, { x: 10, y: 10 }, "e", true, 4)).toContain("--over");
  });

  it("survives a pointer that has not moved off the handle", () => {
    const svg = connectSvg({ x: 5, y: 5 }, { x: 5, y: 5 }, "n", false, 4);
    expect(svg).not.toContain("NaN");
  });
});
