import { test } from "node:test";
import assert from "node:assert/strict";
// `ai` is not linked at the repo root (pnpm strict layout) — resolve it through the admin app.
import { APICallError } from "../apps/admin/node_modules/ai/dist/index.js";
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

function clientWith(role = "admin", storage) {
  return {
    rpc: async () => ({ data: "user-1", error: null }),
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: { role }, error: null }) }) }),
    }),
    storage,
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

function makeParser({ role = "admin", output = profile, fail = false, calls = [], storage } = {}) {
  return createParser({
    createClient: async () => clientWith(role, storage),
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

test("downloads storage-backed resumes from the bucket", async () => {
  const calls = [];
  const pdf = Buffer.concat([Buffer.from("%PDF-"), Buffer.from("1.7 body")]);
  const storage = {
    from: (bucket) => {
      assert.equal(bucket, "candidate-documents");
      return {
        download: async (path) => {
          assert.equal(path, "user-1/upload.pdf");
          return { data: new Blob([pdf]), error: null };
        },
      };
    },
  };
  const parser = makeParser({ calls, storage });
  const r = res();
  await parser(
    {
      method: "POST",
      headers: { authorization: "Bearer token" },
      body: { profile: { kind: "storage", path: "user-1/upload.pdf", name: "ada-cv.pdf" } },
    },
    r,
  );
  assert.equal(r.code, 200);
  const content = calls[0].messages[0].content;
  assert.equal(content[1].mediaType, "application/pdf");
  assert.equal(Buffer.from(content[1].data).toString(), pdf.toString());
});

test("rejects storage resumes the bucket cannot serve", async () => {
  const storage = {
    from: () => ({ download: async () => ({ data: null, error: { message: "not found" } }) }),
  };
  const parser = makeParser({ storage });
  const r = res();
  await parser(
    {
      method: "POST",
      headers: { authorization: "Bearer token" },
      body: { profile: { kind: "storage", path: "user-1/missing.pdf", name: "ada-cv.pdf" } },
    },
    r,
  );
  assert.equal(r.code, 404);
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

function failingParser(error, model = "gpt-4.1-mini") {
  return createParser({
    createClient: async () => clientWith(),
    loadAiSettings: async () => ({ apiKey: "sk-test-key", model }),
    generateText: async () => { throw error; },
  });
}

const textBody = { profile: { kind: "text", text: "A".repeat(200) } };
const providerArgs = { url: "https://api.openai.com/v1/responses", requestBodyValues: {} };

test("reports when OpenAI rejects the saved API key", async () => {
  const r = res();
  await failingParser(new APICallError({ ...providerArgs, message: "Incorrect API key provided", statusCode: 401 }))(
    { method: "POST", headers: { authorization: "Bearer token" }, body: textBody },
    r,
  );
  assert.equal(r.code, 502);
  assert.match(r.body.error, /API key/i);
});

test("reports quota and rate-limit failures", async () => {
  const quota = res();
  await failingParser(new APICallError({ ...providerArgs, message: "You exceeded your current quota", statusCode: 429 }))(
    { method: "POST", headers: { authorization: "Bearer token" }, body: textBody },
    quota,
  );
  assert.equal(quota.code, 502);
  assert.match(quota.body.error, /rate-limited|quota|credits/i);
});

test("points to the model setting when it cannot read PDFs", async () => {
  const r = res();
  await failingParser(
    new APICallError({ ...providerArgs, message: "The model `o1-mini` does not support input_file", statusCode: 400 }),
    "o1-mini",
  )(
    { method: "POST", headers: { authorization: "Bearer token" }, body: textBody },
    r,
  );
  assert.equal(r.code, 502);
  assert.match(r.body.error, /cannot read PDF files/i);
  assert.match(r.body.error, /o1-mini/);
  assert.match(r.body.error, /gpt-4\.1|gpt-4o/);
});

test("reports extraction timeouts", async () => {
  const timeout = new DOMException("The operation timed out.", "TimeoutError");
  const r = res();
  await failingParser(timeout)(
    { method: "POST", headers: { authorization: "Bearer token" }, body: textBody },
    r,
  );
  assert.equal(r.code, 502);
  assert.match(r.body.error, /timed out/i);
});
