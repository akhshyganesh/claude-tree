// ABOUTME: Unit tests for explainItem — the "what / who triggers it / when" invoker strings.
// ABOUTME: These strings back the Detail pane, --list and --json, so they must be stable.
import { describe, expect, it } from "vitest";
import { explainItem } from "../src/loading-model.js";

describe("explainItem", () => {
  it("describes a skill and both its invokers", () => {
    const e = explainItem({ type: "skill", name: "deploy" });
    expect(e.whatIsThis).toContain("skill");
    expect(e.whoTriggers).toContain("you (/deploy)");
    expect(e.whoTriggers).toContain("the model, when your request matches");
  });

  it("says user-only when model invocation is disabled", () => {
    const e = explainItem({
      type: "skill",
      name: "deploy",
      disableModelInvocation: true,
    });
    expect(e.whoTriggers).toContain("user-only: the model cannot auto-invoke");
    expect(e.whoTriggers).not.toContain("matches its description");
  });

  it("notes path-restricted skill globs", () => {
    const e = explainItem({
      type: "skill",
      name: "ui",
      paths: ["src/**/*.tsx"],
    });
    expect(e.whoTriggers).toContain("src/**/*.tsx");
  });

  it("explains a path-scoped rule triggers on file touch", () => {
    const e = explainItem({ type: "rule", pathScoped: true });
    expect(e.whoTriggers).toContain("on file touch");
  });

  it("explains an unconditional rule loads at session start", () => {
    const e = explainItem({ type: "rule", pathScoped: false });
    expect(e.whoTriggers).toContain("session start");
  });

  it("explains agent delegation and @-mention", () => {
    const e = explainItem({ type: "agent", name: "reviewer" });
    expect(e.whoTriggers).toContain("delegates");
    expect(e.whoTriggers).toContain("@-mention");
  });

  it("explains a hook fires deterministically and can't be skipped", () => {
    const e = explainItem({ type: "hook", event: "PreToolUse" });
    expect(e.whoTriggers).toContain("PreToolUse");
    expect(e.whoTriggers).toContain("cannot skip it");
  });

  it("passes the context-cost note through as when-it-costs", () => {
    const e = explainItem({ type: "skill", name: "x", costNote: "deferred: body" });
    expect(e.whenItCostsContext).toBe("deferred: body");
  });
});
