import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createParser } from "../apps/admin/api/parse-candidate.ts";

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY = "public-anon-key";

// Synthetic CV only: made-up person.
const require = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), "../apps/admin/package.json"));
const pdfmake = require("pdfmake");
pdfmake.setUrlAccessPolicy(() => false);
const fontDir = path.join(path.dirname(require.resolve("pdfmake/package.json")), "fonts/Roboto");
pdfmake.setLocalAccessPolicy((file) => path.resolve(file).startsWith(fontDir));
pdfmake.addFonts({ Roboto: { normal: path.join(fontDir, "Roboto-Regular.ttf"), bold: path.join(fontDir, "Roboto-Medium.ttf"), italics: path.join(fontDir, "Roboto-Italic.ttf"), bolditalics: path.join(fontDir, "Roboto-MediumItalic.ttf") } });
async function cvPdf() {
  const pdf = pdfmake.createPdf({ defaultStyle: { font: "Roboto" }, content: [
    "Ada Lovelace", "Platform engineer", "Profile: I build reliable Kubernetes platforms for regulated industries.",
    "Experience", "Senior Platform Engineer, Analytical Engines Ltd, 2019 - present. Ran a 40-cluster estate.",
    "Education", "MSc Computer Science, Sorbonne, 2015", "Certifications", "CKA, CNCF, 2021",
  ] });
  return Buffer.from(await pdf.getBuffer());
}

// What Kimi returns: the resume-shaped structure (RESUME_JSON_SCHEMA).
const resume = {
  full_name: "Ada Lovelace", headline: "Platform engineer", email: "", phone: "", location: "Paris", linkedin_url: "",
  profile: "I build reliable Kubernetes platforms for regulated industries.",
  years_experience: 7,
  experience: [{ title: "Senior Platform Engineer", company: "Analytical Engines Ltd", contract_type: "CDI", location: "", start: "2019", end: "Present", current: true, description: "Ran a 40-cluster estate.", skills: ["Kubernetes"] },
    { title: "SRE", company: "Babbage & Co", contract_type: "", location: "", start: "03/2016", end: "décembre 2018", current: false, description: "On-call lead.", skills: [] }],
  education: [
    { degree: "MSc Computer Science", school: "Sorbonne", start_year: "2013 – 2015", end_year: "" },
    { degree: "BSc Mathematics", school: "Sorbonne", start_year: "", end_year: "2013" },
    { degree: "Baccalauréat S", school: "Lycée Henri-IV", start_year: "2010", end_year: "2010" },
  ],
  certifications: [{ name: "CKA", issuer: "CNCF", year: "2021" }],
  languages: [{ language: "English", level: "C1" }],
  skills: ["Kubernetes", "Go", "Kubernetes"],
  confidence: "high",
};
// What the OpenAI fallback returns: the app's ParsedProfile.
const profile = {
  fullName: "Ada Lovelace", email: "", phone: "", headline: "Platform engineer", currentRole: "Senior Platform Engineer",
  company: "Analytical Engines Ltd", location: "", linkedinUrl: "", yearsExperience: 7, skills: ["Kubernetes"], experience: [],
  education: [], certifications: [], languages: [], summary: "", confidence: "high",
};

function res() {
  return { code: 0, body: undefined, setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
}
const client = {
  rpc: async () => ({ data: "user-1", error: null }),
  from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { role: "hr" }, error: null }) }) }) }),
};
const reply = (content, status = 200) => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }] }), { status });

function makeParser({ answers = [reply(JSON.stringify(resume))], requests = [], openai = [], openaiKey = "", extractPdfText } = {}) {
  return createParser({
    createClient: async () => client,
    loadKimiSettings: async () => ({ apiKey: "moonshot-test-key", model: "kimi-k2.6" }),
    loadAiSettings: async () => ({ apiKey: openaiKey, model: "gpt-4.1-mini" }),
    generateText: async (args) => { openai.push(args); return { output: profile }; },
    kimiFetch: async (url, init) => { requests.push({ url, body: JSON.parse(init.body), headers: init.headers }); return answers.shift(); },
    ...(extractPdfText ? { extractPdfText } : {}),
  });
}
const post = (profileInput) => ({ method: "POST", headers: { authorization: "Bearer token" }, body: { profile: profileInput } });

test("kimi: pasted text is extracted with Structured Output and mapped to the app", async () => {
  const requests = [], openai = [];
  const r = res();
  await makeParser({ requests, openai })(post({ kind: "text", text: "Ada Lovelace, platform engineer. ".repeat(5) }), r);
  assert.equal(r.code, 200);
  assert.equal(r.body.model, "kimi-k2.6");
  assert.equal(openai.length, 0);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://api.moonshot.ai/v1/chat/completions");
  assert.equal(requests[0].headers.authorization, "Bearer moonshot-test-key");
  const format = requests[0].body.response_format;
  assert.equal(format.type, "json_schema");
  assert.equal(format.json_schema.strict, true);
  assert.equal(format.json_schema.name, "resume");
  assert.doesNotMatch(JSON.stringify(format.json_schema.schema), /\$ref|anyOf|oneOf|maxLength/);
  assert.match(requests[0].body.messages[1].content, /pasted CV text[\s\S]*Ada Lovelace/);
  const p = r.body.profile;
  assert.equal(p.summary, resume.profile);
  assert.deepEqual(p.experience.map(item => [item.start, item.end]), [["2019-01", ""], ["2016-03", "2018-12"]]);
  assert.equal(p.experience[0].summary, "Ran a 40-cluster estate.");
  assert.equal(p.currentRole, "Senior Platform Engineer");
  // A range in one field is split; a single year is the end year.
  assert.deepEqual(p.education, [
    { degree: "MSc Computer Science", school: "Sorbonne", start_year: "2013", end_year: "2015" },
    { degree: "BSc Mathematics", school: "Sorbonne", start_year: "", end_year: "2013" },
    { degree: "Baccalauréat S", school: "Lycée Henri-IV", start_year: "", end_year: "2010" },
  ]);
  assert.match(JSON.stringify(requests[0].body.response_format.json_schema.schema), /start_year[\s\S]*end_year/);
  assert.deepEqual(p.languages, [{ language: "English", level: "C1" }]);
  assert.deepEqual(p.skills, ["Kubernetes", "Go"]);
});

test("kimi: a fenced answer with oversized fields is trimmed, not rejected", async () => {
  const r = res();
  const big = { ...resume, headline: "x".repeat(900), confidence: "very", experience: [{ ...resume.experience[0], description: "y".repeat(5000), skills: Array.from({ length: 30 }, (_, i) => `s${i}`) }] };
  await makeParser({ answers: [reply("```json\n" + JSON.stringify(big) + "\n```")] })(post({ kind: "text", text: "x".repeat(80) }), r);
  assert.equal(r.code, 200);
  assert.equal(r.body.profile.headline.length, 300);
  assert.equal(r.body.profile.experience[0].summary.length, 1200);
  assert.equal(r.body.profile.experience[0].skills.length, 12);
  assert.equal(r.body.profile.confidence, "medium");
});

test("kimi: a resume PDF is read here and only its text goes to Kimi", async () => {
  const requests = [];
  const r = res();
  const pdf = await cvPdf();
  await makeParser({ requests })(post({ kind: "pdf", data: pdf.toString("base64"), name: "ada-cv.pdf" }), r);
  assert.equal(r.code, 200);
  const prompt = requests[0].body.messages[1].content;
  assert.match(prompt, /resume PDF "ada-cv\.pdf"/);
  assert.match(prompt, /MSc Computer Science, Sorbonne, 2015/);
  assert.match(prompt, /I build reliable Kubernetes platforms/);
  assert.doesNotMatch(JSON.stringify(requests[0].body), /%PDF-|JVBERi0/);
});

test("kimi: an unreadable answer is retried once", async () => {
  const requests = [];
  const r = res();
  await makeParser({ requests, answers: [reply("Sorry, here is the profile:"), reply(JSON.stringify(resume))] })(post({ kind: "text", text: "x".repeat(80) }), r);
  assert.equal(r.code, 200);
  assert.equal(requests.length, 2);
});

test("kimi: a second bad answer fails without leaking the CV", async () => {
  const r = res();
  await makeParser({ answers: [reply("not json"), reply("{}")] })(post({ kind: "text", text: "secret cv text ".repeat(10) }), r);
  assert.equal(r.code, 502);
  assert.match(r.body.error, /unreadable profile/);
  assert.doesNotMatch(r.body.error, /secret/);
});

test("kimi: a rejected key points to the Kimi setting", async () => {
  const r = res();
  await makeParser({ answers: [new Response("bad key", { status: 401 })] })(post({ kind: "text", text: "x".repeat(80) }), r);
  assert.equal(r.code, 502);
  assert.match(r.body.error, /Kimi API key/);
});

test("kimi: scanned PDFs fall back to OpenAI when it is configured", async () => {
  const pdf = Buffer.from("%PDF-1.7 scanned");
  const openai = [], requests = [];
  const r = res();
  await makeParser({ openai, requests, openaiKey: "sk-test", extractPdfText: async () => "" })(post({ kind: "pdf", data: pdf.toString("base64"), name: "scan.pdf" }), r);
  assert.equal(r.code, 200);
  assert.equal(r.body.model, "gpt-4.1-mini");
  assert.equal(requests.length, 0);
  assert.equal(openai[0].messages[0].content[1].mediaType, "application/pdf");

  const none = res();
  await makeParser({ extractPdfText: async () => "" })(post({ kind: "pdf", data: pdf.toString("base64"), name: "scan.pdf" }), none);
  assert.equal(none.code, 503);
  assert.match(none.body.error, /no selectable text/);
});
