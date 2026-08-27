import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The release workflow is the only path from a green merge to a published
 * package, and it is exercised end to end only by a real tag. These checks lock
 * the two properties that a dry run cannot prove: that the publish step can
 * authenticate at all, and that a doomed release fails before it burns a tag.
 */
const WORKFLOW = readFileSync(".github/workflows/release.yml", "utf8");

/** npm Trusted Publishing needs npm >= 11.5.1 on Node >= 22.14.0. */
const MIN_NPM = [11, 5, 1] as const;
const MIN_NODE_MAJOR = 22;

function parseVersion(version: string): number[] {
  return version.split(".").map((part) => Number.parseInt(part, 10));
}

function atLeast(version: string, minimum: readonly number[]): boolean {
  const parts = parseVersion(version);
  for (const [index, floor] of minimum.entries()) {
    const part = parts[index] ?? 0;
    if (part > floor) return true;
    if (part < floor) return false;
  }
  return true;
}

function indexOfStep(needle: string): number {
  const index = WORKFLOW.indexOf(needle);
  expect(index, `release.yml is missing ${needle}`).toBeGreaterThan(-1);
  return index;
}

describe("release workflow", () => {
  it("pins an npm that supports trusted publishing", () => {
    const pin = WORKFLOW.match(/npm install -g npm@(\d+\.\d+\.\d+)/);
    expect(pin, "release.yml must pin the npm used to publish").not.toBeNull();
    expect(atLeast(pin?.[1] ?? "0.0.0", MIN_NPM)).toBe(true);
  });

  it("runs the publish step on a node new enough for trusted publishing", () => {
    const node = WORKFLOW.match(/node-version: "(\d+)"/);
    expect(node, "release.yml must pin node-version").not.toBeNull();
    expect(Number.parseInt(node?.[1] ?? "0", 10)).toBeGreaterThanOrEqual(MIN_NODE_MAJOR);
  });

  it("checks publish credentials before doing any work", () => {
    expect(indexOfStep("Preflight publish credentials")).toBeLessThan(
      indexOfStep("bun install --frozen-lockfile"),
    );
  });

  it("guards tag and registry before running the gate", () => {
    expect(indexOfStep("Guard version and registry")).toBeLessThan(indexOfStep("bun run test"));
  });

  it("keeps the publish mode decision in one place", () => {
    expect(WORKFLOW.match(/PUBLISH_MODE=/g) ?? []).toHaveLength(2);
    expect(WORKFLOW).toContain("id-token: write");
  });
});
