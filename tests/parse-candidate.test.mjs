import { test } from "node:test";
import assert from "node:assert/strict";
import { createParser } from "../apps/admin/api/parse-candidate.ts";

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY = "public-anon-key";

function res() {
  return {
    code: 0,
    body: undefined,
    setHeader() {},
    status(code) {
      this.code = code;
      return this;
    },
    json(body) {
      this.body = body;
    },
  };
}

function clientWith(role = "admin") {
  return {
    rpc: async () => ({ data: "user-1", error: null }),
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: { role }, error: null }) }) }),
    }),
  };
}

const profile = {
  fullName: "Ada Lovelace",
  email: "ada@example.com",
  phone: "+33 1 02 03 04 05",
  headline: "Platform engineer",
  currentRole: "Senior Platform Engineer",
  company: "Analytical Engines Ltd",
  location: "Paris, France",
  linkedinUrl: "https://www.linkedin.com/in/ada-lovelace",
  yearsExperience: 9,
  skills: ["Kubernetes", "Go", "Terraform"],
  summary: "Platform engineer with nine years of experience running Kubernetes estates.",
  confidence: "high",
};

function makeParser({ role = "admin", output = profile, fail = false, calls = [] } = {}) {
  return createParser({
    createClient: async () => clientWith(role),
    loadAiSettings: async () => ({ apiKey: "sk-test-key", model: "gpt-4.1-mini" }),
    generateText: async (args) => {
      calls.push(args);
      if (fail) throw new Error("provider down");
      return { output };
    },
  });
}

test("requires POST and a bearer token", async () => {
  const parser = makeParser();
  const get = res();
  await parser({ method: "GET", headers: {}, body: null }, get);
  assert.equal(get.code, 405);
  const noAuth = res();
  await parser({ method: "POST", headers: {}, body: {} }, noAuth);
  assert.equal(noAuth.code, 401);
});

test("rejects non-admin callers", async () => {
  const parser = makeParser({ role: "viewer" });
  const r = res();
  await parser(
    { method: "POST", headers: { authorization: "Bearer token" }, body: { profile: { kind: "text", text: "x".repeat(100) } } },
    r,
  );
  assert.equal(r.code, 403);
});

test("validates the intake payload", async () => {
  const parser = makeParser();
  const r = res();
  await parser(
    { method: "POST", headers: { authorization: "Bearer token" }, body: { profile: { kind: "text", text: "short" } } },
    r,
  );
  assert.equal(r.code, 400);
  const badLinkedIn = res();
  await parser(
    {
      method: "POST",
      headers: { authorization: "Bearer token" },
      body: { profile: { kind: "linkedin", url: "https://evil.test/in/x", text: "A".repeat(100) } },
    },
    badLinkedIn,
  );
  assert.equal(badLinkedIn.code, 400);
});

test("rejects PDFs that are not valid PDF data", async () => {
  const parser = makeParser();
  const r = res();
  await parser(
    {
      method: "POST",
      headers: { authorization: "Bearer token" },
      body: { profile: { kind: "pdf", data: Buffer.from("not a pdf").toString("base64"), name: "cv.pdf" } },
    },
    r,
  );
  assert.equal(r.code, 400);
});

test("parses a LinkedIn profile into structured fields", async () => {
  const calls = [];
  const parser = makeParser({ calls });
  const r = res();
  await parser(
    {
      method: "POST",
      headers: { authorization: "Bearer token" },
      body: { profile: { kind: "linkedin", url: "https://www.linkedin.com/in/ada-lovelace", text: "A".repeat(200) } },
    },
    r,
  );
  assert.equal(r.code, 200);
  assert.equal(r.body.profile.fullName, "Ada Lovelace");
  assert.equal(r.body.model, "gpt-4.1-mini");
  assert.equal(calls.length, 1);
  assert.match(calls[0].messages[0].content[0].text, /LinkedIn profile/);
  assert.equal(calls[0].maxRetries, 1);
});

test("attaches resume PDFs as file content", async () => {
  const calls = [];
  const parser = makeParser({ calls });
  const r = res();
  const pdf = Buffer.concat([Buffer.from("%PDF-"), Buffer.from("1.7 body")]);
  await parser(
    {
      method: "POST",
      headers: { authorization: "Bearer token" },
      body: { profile: { kind: "pdf", data: pdf.toString("base64"), name: "ada-cv.pdf" } },
    },
    r,
  );
  assert.equal(r.code, 200);
  const content = calls[0].messages[0].content;
  assert.equal(content[1].mediaType, "application/pdf");
  assert.equal(Buffer.from(content[1].data).toString(), pdf.toString());
});

test("surfaces provider failures without leaking internals", async () => {
  const parser = makeParser({ fail: true });
  const r = res();
  await parser(
    { method: "POST", headers: { authorization: "Bearer token" }, body: { profile: { kind: "text", text: "A".repeat(200) } } },
    r,
  );
  assert.equal(r.code, 502);
  assert.match(r.body.error, /could not be parsed/i);
});
