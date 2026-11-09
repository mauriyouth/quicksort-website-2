import { test } from "node:test";
import assert from "node:assert/strict";
import { extractFields, knownValues, missingFields } from "../apps/admin/server/signatures/fields.ts";
import { DocAccessError, assertNoPlaceholders, fillTemplate } from "../apps/admin/server/signatures/google-docs.ts";

const SA = { client_email: "sa@proj.iam.gserviceaccount.com", private_key: "unused" };
const flat = (s) => s.replace(/[  ]/g, " ");
const facts = {
  fullName: "Jean Paul Martin", email: "j@x.test", role: "Dev", contractType: "CDI",
  salaryMonthly: 3500, dailyRate: 600, startDate: "2026-12-01", probationEnd: "2027-03-01", matricule: "M1",
};

test("extractFields returns unique names in order", () => {
  assert.deepEqual(extractFields("Bonjour {{prenom}}, {{ nom }} {{prenom}}"), ["prenom", "nom"]);
});

test("knownValues formats money, dates and names", () => {
  const v = knownValues(facts, "2026-11-09", "Alice");
  assert.equal(flat(v.salaire_brut_mensuel), "3 500,00 €");
  assert.equal(flat(v.tjm), "600,00 €");
  assert.equal(v.date_debut, "01/12/2026");
  assert.equal(v.fin_periode_essai, "01/03/2027");
  assert.equal(v.date_du_jour, "09/11/2026");
  assert.equal(v.prenom, "Jean");
  assert.equal(v.nom, "Paul Martin");
  assert.equal(v.nom_complet, "Jean Paul Martin");
  assert.equal(v.signataire_quicksort, "Alice");
  const empty = knownValues({ ...facts, salaryMonthly: null, startDate: null, contractType: null }, "2026-11-09", "A");
  assert.equal(empty.salaire_brut_mensuel, "");
  assert.equal(empty.date_debut, "");
  assert.equal(empty.type_contrat, "");
});

test("missingFields lists blank values", () => {
  assert.deepEqual(missingFields(["prenom", "salaire_brut_mensuel"], { prenom: "Jean", salaire_brut_mensuel: " " }), ["salaire_brut_mensuel"]);
  assert.deepEqual(missingFields(["inconnu"], {}), ["inconnu"]);
});

test("assertNoPlaceholders names leftovers", () => {
  assert.throws(() => assertNoPlaceholders("ok {{tjm}}"), /tjm/);
  assert.doesNotThrow(() => assertNoPlaceholders("all good"));
});

const docBody = (text) => ({ body: { content: [{ paragraph: { elements: [{ textRun: { content: text } }] } }] } });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

test("fillTemplate: 404 on copy becomes DocAccessError", async () => {
  const drive = async () => { throw Object.assign(new Error("not found"), { status: 404 }); };
  await assert.rejects(
    fillTemplate(SA, { templateDocId: "t", folderId: "f", name: "n", values: {} }, { driveApi: drive, fetch: async () => json({}), token: async () => "tok" }),
    (error) => error instanceof DocAccessError && error.message.includes(SA.client_email),
  );
});

test("fillTemplate: copies, batch-updates, re-reads, exports", async () => {
  const calls = [];
  const drive = async (_sa, path, opts) => { calls.push(["drive", path, opts]); return { id: "copy1" }; };
  const fetcher = async (url, init = {}) => {
    calls.push(["fetch", String(url), init.method || "GET", init.body]);
    if (String(url).includes(":batchUpdate")) return json({});
    if (String(url).includes("docs.googleapis.com")) return json(docBody("Bonjour Jean"));
    return new Response(new Uint8Array([37, 80, 68, 70]));
  };
  const out = await fillTemplate(SA, { templateDocId: "t1", folderId: "fold", name: "Contrat", values: { prenom: "Jean" } }, { driveApi: drive, fetch: fetcher, token: async () => "tok" });
  assert.equal(out.docCopyId, "copy1");
  assert.deepEqual([...out.pdf], [37, 80, 68, 70]);
  assert.equal(calls[0][1], "/files/t1/copy");
  assert.deepEqual(calls[0][2].body, { name: "Contrat", parents: ["fold"] });
  assert.equal(calls[0][2].query.supportsAllDrives, "true");
  assert.match(calls[1][1], /documents\/copy1:batchUpdate$/);
  assert.deepEqual(JSON.parse(calls[1][3]).requests[0].replaceAllText, { containsText: { text: "{{prenom}}", matchCase: true }, replaceText: "Jean" });
  assert.match(calls[2][1], /documents\/copy1$/);
  assert.match(calls[3][1], /files\/copy1\/export\?mimeType=application%2Fpdf/);
});

test("fillTemplate: leftover placeholder fails before export", async () => {
  const fetcher = async (url) => String(url).includes(":batchUpdate") ? json({}) : json(docBody("Salaire {{salaire_brut_mensuel}}"));
  await assert.rejects(
    fillTemplate(SA, { templateDocId: "t", folderId: "f", name: "n", values: {} }, { driveApi: async () => ({ id: "c" }), fetch: fetcher, token: async () => "tok" }),
    /salaire_brut_mensuel/,
  );
});
