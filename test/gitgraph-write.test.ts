import { describe, expect, it } from "vitest";

import {
  freshBranch,
  gitBranch,
  gitCommit,
  gitMerge,
  gitMetaOf,
  gitMove,
  gitRenameBranch,
  gitSetTag,
  parseGitgraph,
} from "../src/dsl/graph/gitgraph";

/** What the drawing says: each commit as `branch:label[tag]`, in column order, and every parent link. */
function story(body: string) {
  const graph = parseGitgraph(body);
  const meta = gitMetaOf(graph);
  const name = (id: string) => graph.nodes.find((n) => n.id === id)?.title ?? id;
  return {
    commits: graph.nodes.map((n) => `${meta.branchOf[n.id]}:${n.title}${n.meta ? `[${n.meta}]` : ""}`),
    links: graph.edges.map((e) => `${name(e.from.node)}>${name(e.to.node)}`),
    errors: graph.diagnostics.filter((d) => d.severity === "error").length,
  };
}

const FEATURE = ['commit "one"', "branch feature", 'commit "two"', "checkout main", 'commit "three"'].join("\n");

describe("the parser's bookkeeping", () => {
  it("knows each branch's tip, where HEAD ends and where it is after every line", () => {
    const meta = gitMetaOf(parseGitgraph(FEATURE));
    expect(meta.tips).toEqual({ main: "c3", feature: "c1" });
    expect(meta.head).toBe("main");
    expect(meta.headAfter).toEqual({ 1: "main", 2: "feature", 3: "feature", 4: "main", 5: "main" });
  });

  it("records the line of every tag", () => {
    const meta = gitMetaOf(parseGitgraph('commit "a"\ntag "v1"\ncommit "b"\ntag "v2"\ntag "v3"'));
    expect(meta.tagLines).toEqual({ c0: [2], c1: [4, 5] });
  });
});

describe("gitCommit", () => {
  it("appends a commit when HEAD is already on the branch", () => {
    const made = gitCommit(FEATURE, "main")!;
    expect(made.body).toBe(`${FEATURE}\ncommit "New commit"`);
    expect(story(made.body).commits.at(-1)).toBe("main:New commit");
    expect(parseGitgraph(made.body).nodes.at(-1)!.id).toBe(made.id);
  });

  it("writes the checkout it needs", () => {
    const made = gitCommit(FEATURE, "feature")!;
    expect(made.body).toBe(`${FEATURE}\ncheckout feature\ncommit "New commit"`);
    expect(story(made.body).links).toContain("two>New commit");
  });

  it("starts an empty graph", () => {
    const made = gitCommit("", "main")!;
    expect(made.body).toBe('commit "New commit"');
    expect(story(made.body).commits).toEqual(["main:New commit"]);
  });

  it("refuses a branch that is not there", () => {
    expect(gitCommit(FEATURE, "nope")).toBeNull();
  });

  it("keeps the author's indent and drops trailing blank lines", () => {
    expect(gitCommit('  commit "a"\n\n', "main")!.body).toBe('  commit "a"\n  commit "New commit"');
  });
});

describe("gitBranch", () => {
  it("branches off the current tip when nothing is picked", () => {
    const made = gitBranch(FEATURE, null)!;
    expect(made.branch).toBe("feature2");
    expect(made.body).toBe(`${FEATURE}\nbranch feature2\ncommit "New commit"`);
    expect(story(made.body).links).toContain("three>New commit");
  });

  it("branches off a commit in the middle and puts HEAD back for what follows", () => {
    const made = gitBranch(FEATURE, "c0")!;
    expect(made.body.split("\n").slice(0, 4)).toEqual([
      'commit "one"',
      "branch feature2",
      'commit "New commit"',
      "checkout main",
    ]);
    const s = story(made.body);
    expect(s.errors).toBe(0);
    expect(s.links).toContain("one>New commit");
    /* Everything that was there is still descended from what it was. */
    expect(s.links).toContain("one>two");
    expect(s.links).toContain("one>three");
    expect(s.commits).toContain("feature:two");
    expect(s.commits).toContain("feature2:New commit");
    expect(made.id).toBe(parseGitgraph(made.body).nodes.find((n) => n.title === "New commit")!.id);
  });

  it("leaves the checkout out when the next statement picks a branch anyway", () => {
    const made = gitBranch(FEATURE, "c1")!;
    expect(made.body.split("\n").slice(3, 6)).toEqual(["branch feature2", 'commit "New commit"', "checkout main"]);
    expect(made.body.split("\n").filter((l) => l === "checkout main")).toHaveLength(1);
  });

  it("starts after the commit's tag, so the tag stays on it", () => {
    const made = gitBranch('commit "a"\ntag "v1"\ncommit "b"', "c0")!;
    const s = story(made.body);
    expect(s.commits).toEqual(["main:a[v1]", "feature:New commit", "main:b"]);
    expect(s.links).toEqual(["a>New commit", "a>b"]);
  });

  it("names the branch freshly", () => {
    expect(freshBranch(["main"])).toBe("feature");
    expect(freshBranch(["main", "feature", "feature2"])).toBe("feature3");
  });
});

describe("gitMerge", () => {
  it("merges one branch's tip into another, with the checkout it needs", () => {
    const made = gitMerge(`${FEATURE}\ncheckout feature`, "feature", "main")!;
    expect(made.body.split("\n").slice(-2)).toEqual(["checkout main", "merge feature"]);
    const s = story(made.body);
    expect(s.links).toContain("three>merge feature");
    expect(s.links).toContain("two>merge feature");
    expect(s.commits.at(-1)).toBe("main:merge feature");
  });

  it("needs no checkout when HEAD is already there", () => {
    expect(gitMerge(FEATURE, "feature", "main")!.body).toBe(`${FEATURE}\nmerge feature`);
  });

  it("refuses what has nothing to merge", () => {
    expect(gitMerge(FEATURE, "main", "main")).toBeNull();
    expect(gitMerge(FEATURE, "nope", "main")).toBeNull();
    expect(gitMerge("branch empty", "main", "empty")).toBeNull();
    /* main's tip already holds feature's. */
    expect(gitMerge(`${FEATURE}\nmerge feature`, "feature", "main")).toBeNull();
  });
});

describe("gitRenameBranch", () => {
  it("renames every statement that names it, and nothing else", () => {
    const body = `${FEATURE}\nswitch feature\ncommit "feature work"\ncheckout main\nmerge feature "v2"`;
    const next = gitRenameBranch(body, "feature", "parser")!;
    expect(next).toBe(body.replace(/(branch|switch|merge) feature/g, "$1 parser"));
    expect(next).toContain('commit "feature work"');
    expect(story(next).errors).toBe(0);
  });

  it("refuses main, a taken name and one that is not a word", () => {
    expect(gitRenameBranch(FEATURE, "main", "trunk")).toBeNull();
    expect(gitRenameBranch(FEATURE, "feature", "main")).toBeNull();
    expect(gitRenameBranch(FEATURE, "feature", "two words")).toBeNull();
    expect(gitRenameBranch(FEATURE, "feature", "feature")).toBe(FEATURE);
  });
});

describe("gitSetTag", () => {
  it("adds a tag straight after the commit", () => {
    const next = gitSetTag(FEATURE, "c0", "v1")!;
    expect(next.split("\n").slice(0, 2)).toEqual(['commit "one"', 'tag "v1"']);
    expect(story(next).commits[0]).toBe("main:one[v1]");
  });

  it("rewrites and removes one in place", () => {
    const body = 'commit "a"\ntag v1\ncommit "b"';
    expect(gitSetTag(body, "c0", "v2")).toBe('commit "a"\ntag "v2"\ncommit "b"');
    expect(gitSetTag(body, "c0", null)).toBe('commit "a"\ncommit "b"');
    expect(gitSetTag(body, "c0", "  ")).toBe('commit "a"\ncommit "b"');
  });

  it("keeps only the drawn tag when there were two", () => {
    expect(gitSetTag('commit "a"\ntag "x"\ntag "y"', "c0", "z")).toBe('commit "a"\ntag "z"');
  });

  it("tags a merge commit too", () => {
    const next = gitSetTag(`${FEATURE}\nmerge feature`, "c5", "v1")!;
    expect(story(next).commits.at(-1)).toBe("main:merge feature[v1]");
  });
});

describe("gitMove", () => {
  const LINE = 'commit "a"\ncommit "b"\ntag "vb"\ncommit "c"';

  it("swaps two commits that follow each other, tags and all", () => {
    const made = gitMove(LINE, "c1", 1)!;
    expect(story(made.body).commits).toEqual(["main:a", "main:c", "main:b[vb]"]);
    /* The moved commit is now the later place. */
    expect(parseGitgraph(made.body).nodes.find((n) => n.id === made.id)!.title).toBe("b");
    expect(gitMove(LINE, "c1", -1)!.body.split("\n")).toEqual(['commit "b"', 'tag "vb"', 'commit "a"', 'commit "c"']);
  });

  it("refuses the ends of a branch", () => {
    expect(gitMove(LINE, "c0", -1)).toBeNull();
    expect(gitMove(LINE, "c3", 1)).toBeNull();
  });

  it("refuses where another commit descends from the earlier one", () => {
    /* `one` has two children, so `three` cannot go before it. */
    expect(gitMove(FEATURE, "c3", -1)).toBeNull();
    /* Nor across the start of a branch. */
    expect(gitMove(FEATURE, "c1", -1)).toBeNull();
  });

  it("refuses a merge", () => {
    /* `four` follows the merge, which has two parents. */
    expect(gitMove(`${FEATURE}\nmerge feature\ncommit "four"`, "c8", -1)).toBeNull();
  });
});
