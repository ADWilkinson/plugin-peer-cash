import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * A plugin shares one runtime with its host, so `@elizaos/core` must resolve to
 * the host's copy. Declaring it as a runtime dependency - pinned exactly - makes
 * every package manager nest a second core under the plugin whenever the host is
 * on any other version, and the two module graphs then disagree about `Service`,
 * `logger`, and every other core identity. Peer plus dev is the contract every
 * first-party elizaOS plugin ships; these checks stop a stray `bun add` from
 * quietly undoing it.
 */
const PACKAGE = JSON.parse(readFileSync("package.json", "utf8")) as {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const BUILD = readFileSync("build.ts", "utf8");

/** Every package the host also loads, and must therefore own exactly one of. */
const HOST_OWNED = ["@elizaos/core"] as const;

describe("package contract", () => {
  for (const name of HOST_OWNED) {
    it(`declares ${name} as a peer, never a runtime dependency`, () => {
      expect(PACKAGE.dependencies ?? {}).not.toHaveProperty(name);
      expect(PACKAGE.peerDependencies ?? {}).toHaveProperty(name);
    });

    it(`accepts more than one ${name} release`, () => {
      const range = PACKAGE.peerDependencies?.[name] ?? "";
      expect(range, `${name} peer range must not be an exact pin`).toMatch(/^[\^~>]/);
    });

    it(`keeps ${name} installable for local typecheck and tests`, () => {
      expect(PACKAGE.devDependencies ?? {}).toHaveProperty(name);
    });

    it(`leaves ${name} out of the bundle`, () => {
      expect(BUILD).toContain(`"${name}"`);
      expect(BUILD.match(/external: \[(.*?)\]/s)?.[1] ?? "").toContain(name);
    });
  }
});
