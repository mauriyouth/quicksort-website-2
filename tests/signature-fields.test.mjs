import { test } from "node:test";
import assert from "node:assert/strict";
import { extractFields, knownValues, loadPersonFacts, missingFields } from "../apps/admin/server/signatures/fields.ts";
import { DocAccessError, assertNoPlaceholders, fillTemplate, readDocText } from "../apps/admin/server/signatures/google-docs.ts";

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
  assert.throws(() => assertNoPlaceholders("{{prenom"), /placeholders were left/);
  assert.throws(() => assertNoPlaceholders("{{ nom complet }}"), /placeholders were left/);
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
  assert.match(calls[1][1], /documents\/copy1\?includeTabsContent=true$/);
  assert.match(calls[2][1], /documents\/copy1:batchUpdate$/);
  assert.deepEqual(JSON.parse(calls[2][3]).requests[0].replaceAllText, { containsText: { text: "{{prenom}}", matchCase: true }, replaceText: "Jean" });
  assert.match(calls[3][1], /documents\/copy1\?includeTabsContent=true$/);
  assert.match(calls[4][1], /files\/copy1\/export\?mimeType=application%2Fpdf/);
});

test("fillTemplate: leftover placeholder fails before export", async () => {
  const fetcher = async (url) => String(url).includes(":batchUpdate") ? json({}) : json(docBody("Salaire {{salaire_brut_mensuel}}"));
  await assert.rejects(
    fillTemplate(SA, { templateDocId: "t", folderId: "f", name: "n", values: {} }, { driveApi: async () => ({ id: "c" }), fetch: fetcher, token: async () => "tok" }),
    /salaire_brut_mensuel/,
  );
});

const tmpl = (text, extra = {}) => ({ body: { content: [{ paragraph: { elements: [{ textRun: { content: text } }] } }] }, ...extra });
const footer = (text) => ({ footers: { f1: { content: [{ paragraph: { elements: [{ textRun: { content: text } }] } }] } } });

test("readDocText includes headers, footers, footnotes and nested tables", async () => {
  const seg = (t) => ({ content: [{ paragraph: { elements: [{ textRun: { content: t } }] } }] });
  const doc = {
    body: { content: [{ table: { tableRows: [{ tableCells: [{ content: [{ table: { tableRows: [{ tableCells: [seg("nested ").content ? { content: seg("nested ").content } : {}] }] } }] }] }] } }] },
    headers: { h: seg("HEAD {{a}}") }, footers: { f: seg("FOOT {{b}}") }, footnotes: { n: seg("NOTE {{c}}") },
  };
  const text = await readDocText(SA, "d", { fetch: async () => json(doc), token: async () => "t" });
  for (const part of ["nested", "{{a}}", "{{b}}", "{{c}}"]) assert.ok(text.includes(part), part);
});

const tabbed = (...tabs) => ({ tabs });
const tab = (doc, childTabs = []) => ({ documentTab: doc, childTabs });

test("readDocText reads every tab, child tabs included", async () => {
  const doc = tabbed(tab(tmpl("Premier onglet {{prenom}}")), tab(tmpl("Second {{salaire_brut_mensuel}}", footer("{{matricule}}")), [tab(tmpl("Annexe {{clause}}"))]));
  const text = await readDocText(SA, "d", { fetch: async () => json(doc), token: async () => "t" });
  for (const part of ["{{prenom}}", "{{salaire_brut_mensuel}}", "{{matricule}}", "{{clause}}"]) assert.ok(text.includes(part), part);
});

test("fillTemplate: a placeholder left in a second tab throws", async () => {
  const fetcher = async (url) => String(url).includes(":batchUpdate") ? json({})
    : json(tabbed(tab(tmpl("Bonjour J")), tab(tmpl("Salaire {{salaire_brut_mensuel}}"))));
  await assert.rejects(
    fillTemplate(SA, { templateDocId: "t", folderId: "f", name: "n", values: { prenom: "J" } }, { driveApi: async () => ({ id: "c" }), fetch: fetcher, token: async () => "tok" }),
    /salaire_brut_mensuel/,
  );
});

test("fillTemplate: leftover footer placeholder throws and the copy is trashed", async () => {
  const drives = [];
  const drive = async (_sa, path, opts) => { drives.push([path, opts?.method, opts?.body]); return { id: "c9" }; };
  const fetcher = async (url) => String(url).includes(":batchUpdate") ? json({}) : json(tmpl("ok", footer("Page {{matricule}}")));
  await assert.rejects(
    fillTemplate(SA, { templateDocId: "t", folderId: "f", name: "n", values: { prenom: "J" } }, { driveApi: drive, fetch: fetcher, token: async () => "tok" }),
    /matricule/,
  );
  assert.deepEqual(drives[1], ["/files/c9", "PATCH", { trashed: true }]);
});

test("fillTemplate: export failure trashes the copy", async () => {
  const drives = [];
  const drive = async (_sa, path, opts) => { drives.push([path, opts?.method]); return { id: "c8" }; };
  const fetcher = async (url) => String(url).includes("/export") ? new Response("no", { status: 500 }) : String(url).includes(":batchUpdate") ? json({}) : json(tmpl("done"));
  await assert.rejects(
    fillTemplate(SA, { templateDocId: "t", folderId: "f", name: "n", values: {} }, { driveApi: drive, fetch: fetcher, token: async () => "tok" }),
    /export/,
  );
  assert.deepEqual(drives[1], ["/files/c8", "PATCH"]);
});

test("fillTemplate replaces every spelling present, spaced included", async () => {
  let sent;
  let reads = 0;
  const fetcher = async (url, init) => {
    if (String(url).includes(":batchUpdate")) { sent = JSON.parse(init.body).requests.map((r) => r.replaceAllText.containsText.text); return json({}); }
    if (String(url).includes("/export")) return new Response(new Uint8Array([1]));
    return json(tmpl(reads++ === 0 ? "{{ nom }} et {{nom}}" : "Martin et Martin"));
  };
  await fillTemplate(SA, { templateDocId: "t", folderId: "f", name: "n", values: { nom: "Martin" } }, { driveApi: async () => ({ id: "c" }), fetch: fetcher, token: async () => "tok" });
  assert.deepEqual([...sent].sort(), ["{{ nom }}", "{{nom}}"]);
});

test("knownValues gives empty for non-finite numbers", () => {
  assert.equal(knownValues({ ...facts, salaryMonthly: NaN, dailyRate: Infinity }, "2026-11-09", "A").salaire_brut_mensuel, "");
});

// Minimal mock of the Supabase query builder used by loadPersonFacts.
function mockClient(tables) {
  return {
    from(table) {
      const filters = [];
      let order = null;
      const q = {
        select() { return q; },
        eq(c, v) { filters.push((r) => r[c] === v); return q; },
        in(c, v) { filters.push((r) => v.includes(r[c])); return q; },
        order(c, o) { order = [c, o.ascending]; return q; },
        then(resolve) {
          let rows = tables[table].filter((r) => filters.every((f) => f(r)));
          if (order) rows = [...rows].sort((a, b) => (a[order[0]] < b[order[0]] ? -1 : 1) * (order[1] ? 1 : -1));
          resolve({ data: rows, error: null });
        },
        async maybeSingle() { const { data } = await new Promise((r) => q.then(r)); return { data: data[0] || null, error: null }; },
      };
      return q;
    },
  };
}

test("loadPersonFacts picks the open employment and today's salary row", async () => {
  const client = mockClient({
    hr_people: [{ id: "p", full_name: "Jean Martin", email: "j@x.test" }],
    employees: [
      { id: "e-old", person_id: "p", role: "Old", start_date: "2020-01-01", status: "ended", probation_end: null, offer_id: null, matricule: "M0" },
      { id: "e-open", person_id: "p", role: "Dev", start_date: "2019-01-01", status: "active", probation_end: "2019-06-01", offer_id: "o1", matricule: "M1" },
    ],
    employee_salaries: [
      { employee_id: "e-open", rate_kind: "monthly", salary_monthly: 3000, daily_rate: null, start_date: "2019-01-01", end_date: "2019-12-31" },
      { employee_id: "e-open", rate_kind: "monthly", salary_monthly: 3500, daily_rate: null, start_date: "2020-01-01", end_date: null },
      { employee_id: "e-open", rate_kind: "monthly", salary_monthly: 9999, daily_rate: null, start_date: "2999-01-01", end_date: null },
      { employee_id: "e-old", rate_kind: "monthly", salary_monthly: 1, daily_rate: null, start_date: "2020-01-01", end_date: null },
    ],
    offers: [{ id: "o1", contract_type: "CDI" }],
  });
  const f = await loadPersonFacts(client, "p");
  assert.deepEqual(f, { fullName: "Jean Martin", email: "j@x.test", role: "Dev", contractType: "CDI", salaryMonthly: 3500, dailyRate: null, startDate: "2019-01-01", probationEnd: "2019-06-01", matricule: "M1" });
});

test("loadPersonFacts falls back to the latest ended employment and splits daily rates", async () => {
  const client = mockClient({
    hr_people: [{ id: "p", full_name: "A B", email: "" }],
    employees: [
      { id: "e1", person_id: "p", role: "R1", start_date: "2018-01-01", status: "ended", probation_end: null, offer_id: null, matricule: "M1" },
      { id: "e2", person_id: "p", role: "R2", start_date: "2021-01-01", status: "ended", probation_end: null, offer_id: null, matricule: "M2" },
    ],
    employee_salaries: [{ employee_id: "e2", rate_kind: "daily", salary_monthly: null, daily_rate: 650, start_date: "2021-01-01", end_date: null }],
    hr_applications: [],
    offers: [],
  });
  const f = await loadPersonFacts(client, "p");
  assert.equal(f.role, "R2");
  assert.equal(f.dailyRate, 650);
  assert.equal(f.salaryMonthly, null);
  assert.equal(f.contractType, null);
});

const candidate = (offers) => mockClient({
  hr_people: [{ id: "p", full_name: "Cand Idate", email: "c@x.test" }],
  employees: [],
  employee_salaries: [],
  hr_applications: [{ id: "a1", person_id: "p" }, { id: "a2", person_id: "other" }],
  offers,
});

test("loadPersonFacts reads the latest accepted CDI offer for a candidate", async () => {
  const f = await loadPersonFacts(candidate([
    { application_id: "a1", status: "accepted", title: "Old", contract_type: "CDI", salary_monthly: 1000, cjm: 0, created_at: "2026-01-01" },
    { application_id: "a1", status: "accepted", title: "Data Engineer", contract_type: "CDI", salary_monthly: 4200, cjm: 0, created_at: "2026-06-01" },
    { application_id: "a1", status: "declined", title: "Declined", contract_type: "CDI", salary_monthly: 9, cjm: 0, created_at: "2026-09-01" },
    { application_id: "a2", status: "accepted", title: "Other", contract_type: "CDI", salary_monthly: 7, cjm: 0, created_at: "2026-10-01" },
  ]), "p");
  assert.deepEqual(f, { fullName: "Cand Idate", email: "c@x.test", role: "Data Engineer", contractType: "CDI", salaryMonthly: 4200, dailyRate: null, startDate: null, probationEnd: null, matricule: null });
});

test("loadPersonFacts maps an accepted Freelance offer to a daily rate", async () => {
  const f = await loadPersonFacts(candidate([
    { application_id: "a1", status: "accepted", title: "Consultant", contract_type: "Freelance", salary_monthly: 0, cjm: 650, created_at: "2026-06-01" },
  ]), "p");
  assert.equal(f.dailyRate, 650);
  assert.equal(f.salaryMonthly, null);
  assert.equal(f.contractType, "Freelance");
  assert.equal(f.role, "Consultant");
  assert.equal(f.startDate, null);
});

test("loadPersonFacts with no employment and no accepted offer is empty", async () => {
  const f = await loadPersonFacts(candidate([{ application_id: "a1", status: "shared", title: "T", contract_type: "CDI", salary_monthly: 1, cjm: 0, created_at: "2026-06-01" }]), "p");
  assert.deepEqual(f, { fullName: "Cand Idate", email: "c@x.test", role: "", contractType: null, salaryMonthly: null, dailyRate: null, startDate: null, probationEnd: null, matricule: null });
  const v = knownValues(f, "2026-11-09", "A");
  for (const k of ["poste", "type_contrat", "salaire_brut_mensuel", "tjm", "date_debut"]) assert.equal(v[k], "", k);
});

const rehire = (offers) => mockClient({
  hr_people: [{ id: "p", full_name: "Re Hire", email: "r@x.test" }],
  employees: [{ id: "e-old", person_id: "p", role: "Old role", start_date: "2020-01-01", status: "ended", probation_end: "2020-04-01", offer_id: "o-old", matricule: "M0" }],
  employee_salaries: [{ employee_id: "e-old", rate_kind: "monthly", salary_monthly: 2000, daily_rate: null, start_date: "2020-01-01", end_date: null }],
  hr_applications: [{ id: "a-old", person_id: "p" }, { id: "a-new", person_id: "p" }],
  offers,
});
const oldOffer = { id: "o-old", application_id: "a-old", status: "accepted", title: "Old role", contract_type: "CDD", salary_monthly: 2000, cjm: 0, created_at: "2019-12-01" };
const newOffer = { id: "o-new", application_id: "a-new", status: "accepted", title: "Lead Engineer", contract_type: "CDI", salary_monthly: 5200, cjm: 0, created_at: "2026-10-01" };
const rehireFacts = { fullName: "Re Hire", email: "r@x.test", role: "Lead Engineer", contractType: "CDI", salaryMonthly: 5200, dailyRate: null, startDate: null, probationEnd: null, matricule: null };

test("loadPersonFacts with an application reads that application's accepted offer, not the ended employment", async () => {
  const declined = { id: "o-dec", application_id: "a-new", status: "declined", title: "Declined", contract_type: "CDI", salary_monthly: 9, cjm: 0, created_at: "2026-10-05" };
  assert.deepEqual(await loadPersonFacts(rehire([oldOffer, newOffer, declined]), "p", "a-new"), rehireFacts);
});

test("loadPersonFacts with an application only reads that application's offers", async () => {
  const f = await loadPersonFacts(rehire([oldOffer]), "p", "a-new");
  assert.deepEqual(f, { fullName: "Re Hire", email: "r@x.test", role: "", contractType: null, salaryMonthly: null, dailyRate: null, startDate: null, probationEnd: null, matricule: null });
  const freelanceOffer = { id: "o-f", application_id: "a-new", status: "accepted", title: "Consultant", contract_type: "Freelance", salary_monthly: 0, cjm: 700, created_at: "2026-10-01" };
  const freelance = await loadPersonFacts(rehire([oldOffer, freelanceOffer]), "p", "a-new");
  assert.equal(freelance.dailyRate, 700);
  assert.equal(freelance.salaryMonthly, null);
  assert.equal(freelance.contractType, "Freelance");
});

test("loadPersonFacts without an application uses the offer when no employment is open", async () => {
  assert.deepEqual(await loadPersonFacts(rehire([oldOffer, newOffer]), "p"), rehireFacts);
});
