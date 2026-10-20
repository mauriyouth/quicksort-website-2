import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appUrl = new URL("../apps/intelligence/src/App.tsx", import.meta.url);

test("event acquisition separates hosted and attended workflows", async () => {
  const source = await readFile(appUrl, "utf8");

  assert.match(source, /type EventKind = "Hosted" \| "Attend"/);
  assert.match(source, /Events we host/);
  assert.match(source, /Events to attend/);
  assert.match(source, /Upload prospects/);
  assert.match(source, /Map people/);
  assert.match(source, /From hosted and attended events/);
  assert.match(source, /Event attended/);
});

test("legacy events remain classified as hosted", async () => {
  const source = await readFile(appUrl, "utf8");
  assert.match(source, /event\.kind === "Attend" \? "Attend" : "Hosted"/);
});
