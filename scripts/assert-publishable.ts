#!/usr/bin/env bun
/**
 * Fail a release before npm publish if the triggering tag does not match
 * package.json, or if that version is already on the registry.
 */

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export interface PublishablePackage {
  name: string;
  version: string;
}

export function readPackage(source: string): PublishablePackage {
  const parsed = JSON.parse(source) as { name?: unknown; version?: unknown };
  if (typeof parsed.name !== "string" || parsed.name.length === 0) {
    throw new Error("package.json is missing a name");
  }
  if (typeof parsed.version !== "string" || parsed.version.length === 0) {
    throw new Error("package.json is missing a version");
  }
  return { name: parsed.name, version: parsed.version };
}

export function assertTagMatchesVersion(tag: string | undefined, version: string): void {
  if (tag === undefined || tag === "") return;
  const expected = `v${version}`;
  if (tag !== expected) {
    throw new Error(
      `Triggering tag ${tag} does not match package.json version ${version}; expected ${expected}.`,
    );
  }
}

export function assertVersionNotPublished(
  name: string,
  version: string,
  publishedVersions: readonly string[],
): void {
  if (publishedVersions.includes(version)) {
    throw new Error(`${name}@${version} is already on the registry; refusing to republish.`);
  }
}

export async function fetchPublishedVersions(
  name: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const url = `https://registry.npmjs.org/${encodeURIComponent(name)}`;
  const response = await fetchImpl(url);
  if (response.status === 404) return [];
  if (!response.ok) {
    throw new Error(`registry lookup for ${name} failed: HTTP ${response.status}`);
  }
  const body = (await response.json()) as { versions?: Record<string, unknown> };
  return Object.keys(body.versions ?? {});
}

export async function assertPublishable(options: {
  source: string;
  tag?: string;
  fetchImpl?: typeof fetch;
}): Promise<PublishablePackage> {
  const pkg = readPackage(options.source);
  assertTagMatchesVersion(options.tag, pkg.version);
  const published = await fetchPublishedVersions(pkg.name, options.fetchImpl ?? fetch);
  assertVersionNotPublished(pkg.name, pkg.version, published);
  return pkg;
}

function parseTagFlag(argv: string[]): string | undefined {
  const index = argv.indexOf("--tag");
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error("--tag requires a value");
  }
  return value;
}

async function main() {
  const tag = parseTagFlag(process.argv.slice(2));
  const source = readFileSync("package.json", "utf8");
  const pkg = await assertPublishable({ source, tag });
  console.log(`${pkg.name}@${pkg.version} is unpublished and matches ${tag ?? "no tag"}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
