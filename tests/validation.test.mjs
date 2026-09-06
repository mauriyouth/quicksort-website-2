import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isLinkedInUrl,
  slugify,
  validateFile,
} from "../packages/db/src/validation.ts";
test("LinkedIn application links reject deceptive hosts and unsafe schemes", () => {
  for (const url of [
    "https://www.linkedin.com/jobs/view/123",
    "https://linkedin.com/jobs/123",
  ])
    assert.equal(isLinkedInUrl(url), true);
  for (const url of [
    "javascript:alert(1)",
    "http://linkedin.com/jobs/123",
    "https://linkedin.com.evil.test/jobs/123",
    "https://evil.test@linkedin.com/jobs/123",
    "https://linkedin.com",
    "https://linkedin.com:8443/jobs/123",
  ])
    assert.equal(isLinkedInUrl(url), false, url);
});
test("uploads enforce file limits and contract PDFs", () => {
  assert.doesNotThrow(() =>
    validateFile({ size: 100, type: "application/pdf" }, true),
  );
  for (const file of [
    { size: 0, type: "application/pdf" },
    { size: 10485761, type: "application/pdf" },
    { size: 50, type: "text/html" },
  ])
    assert.throws(() => validateFile(file));
  assert.throws(() => validateFile({ size: 50, type: "image/png" }, true));
});
test("slugs are readable and URL safe", () => {
  assert.equal(slugify(" Ingénieur IA / ML! "), "ingenieur-ia-ml");
});
