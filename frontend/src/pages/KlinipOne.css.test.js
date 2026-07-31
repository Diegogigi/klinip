// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./KlinipOne.css", import.meta.url), "utf8");

describe("Klinip One visual safeguards", () => {
  it("includes explicit dark theme coverage", () => {
    expect(css).toContain("body.theme-dark .ko-page");
    expect(css).toContain("body.theme-dark .ko-dialog");
    expect(css).toContain("body.theme-dark .ko-action-card");
    expect(css).toContain("body.theme-dark .ko-choice-card");
  });

  it("includes a compact phone layout with usable touch targets", () => {
    expect(css).toContain("@media (max-width: 768px)");
    expect(css).toContain("min-height: 48px");
    expect(css).toContain(".ko-sticky-actions");
    expect(css).toContain(".ko-dialog-backdrop");
  });
});
