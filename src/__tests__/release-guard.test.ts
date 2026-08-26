import { describe, expect, it } from "vitest";
import {
  assertPublishable,
  assertTagMatchesVersion,
  assertVersionNotPublished,
  readPackage,
} from "../../scripts/assert-publishable.js";

const PACKAGE = JSON.stringify({
  name: "@davyjones0x/plugin-peer-cash",
  version: "0.1.2",
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("release guard", () => {
  it("reads name and version from package.json", () => {
    expect(readPackage(PACKAGE)).toEqual({
      name: "@davyjones0x/plugin-peer-cash",
      version: "0.1.2",
    });
  });

  it("rejects a missing version field", () => {
    expect(() => readPackage(JSON.stringify({ name: "@davyjones0x/plugin-peer-cash" }))).toThrow(
      /missing a version/,
    );
  });

  it("allows workflow_dispatch with no tag", () => {
    expect(() => assertTagMatchesVersion(undefined, "0.1.2")).not.toThrow();
    expect(() => assertTagMatchesVersion("", "0.1.2")).not.toThrow();
  });

  it("rejects a tag that does not match package.json", () => {
    expect(() => assertTagMatchesVersion("v0.1.1", "0.1.2")).toThrow(
      /tag v0\.1\.1 does not match package\.json version 0\.1\.2; expected v0\.1\.2/i,
    );
  });

  it("accepts the matching v-prefixed tag", () => {
    expect(() => assertTagMatchesVersion("v0.1.2", "0.1.2")).not.toThrow();
  });

  it("fails fast when the version is already on the registry", () => {
    expect(() =>
      assertVersionNotPublished("@davyjones0x/plugin-peer-cash", "0.1.2", [
        "0.1.0",
        "0.1.1",
        "0.1.2",
      ]),
    ).toThrow(/already on the registry; refusing to republish/);
  });

  it("allows an unpublished version", () => {
    expect(() =>
      assertVersionNotPublished("@davyjones0x/plugin-peer-cash", "0.1.2", ["0.1.0", "0.1.1"]),
    ).not.toThrow();
  });

  it("looks up the packument and refuses a published version", async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse(200, { versions: { "0.1.1": {}, "0.1.2": {} } });

    await expect(assertPublishable({ source: PACKAGE, tag: "v0.1.2", fetchImpl })).rejects.toThrow(
      /already on the registry/,
    );
  });

  it("treats a missing packument as unpublished", async () => {
    const fetchImpl: typeof fetch = async () => jsonResponse(404, {});

    await expect(assertPublishable({ source: PACKAGE, fetchImpl })).resolves.toEqual({
      name: "@davyjones0x/plugin-peer-cash",
      version: "0.1.2",
    });
  });

  it("surfaces a non-404 registry failure instead of publishing", async () => {
    const fetchImpl: typeof fetch = async () => jsonResponse(500, {});

    await expect(assertPublishable({ source: PACKAGE, fetchImpl })).rejects.toThrow(
      /registry lookup.*HTTP 500/,
    );
  });
});
