import assert from "node:assert/strict";
import test from "node:test";
import { matchPayslips, normalizeName, sameMatricule } from "../apps/admin/src/payslips/match.ts";
import { payslipTitle } from "../apps/admin/src/payslips/parse.ts";

const pdf = (o = {}) => ({ fileName: "x.pdf", matricule: "00026", period: "2026-10", index: 1, nameFromFile: "ADA TEST", sha256: "aa", bytes: new Uint8Array(), ...o });
const emp = (o = {}) => ({ id: "e1", person_id: "p1", matricule: "00026", status: "active", end_date: null, full_name: "Ada Test", start_date: "2024-01-01", ...o });
const one = (f, e, filed = []) => matchPayslips([f], e, filed)[0];

test("normalizeName and sameMatricule", () => {
  assert.equal(normalizeName("Éloïse-Marie_Dupont"), "dupont eloise marie");
  assert.ok(sameMatricule("00026", "26"));
  assert.ok(!sameMatricule("00026", "27"));
  assert.ok(!sameMatricule("QS-0000", "0"));
  assert.ok(sameMatricule("QS-0000", "QS-0000"));
});

test("matricule held by one person with a matching name is matched", () => {
  const r = one(pdf(), [emp()]);
  assert.equal(r.status, "matched"); assert.equal(r.personId, "p1"); assert.equal(r.employeeIdForMatricule, "e1"); assert.equal(r.printedName, "ADA TEST");
});

test("leading zeros and compound names still match", () => {
  assert.equal(one(pdf({ matricule: "00026" }), [emp({ matricule: "26" })]).status, "matched");
  const r = one(pdf({ nameFromFile: "ADOTRI FRIMPONG MALCOM MICHEL-ANGE" }), [emp({ full_name: "Malcom Michel-Ange Adotri Frimpong" })]);
  assert.equal(r.status, "matched");
});

test("a leaver on an ended employment is matched", () => {
  assert.equal(one(pdf(), [emp({ status: "ended", end_date: "2026-09-30" })]).status, "matched");
});

test("matricule held but name disagrees needs confirmation, naming both", () => {
  const r = one(pdf({ nameFromFile: "BOB OTHER" }), [emp()]);
  assert.equal(r.status, "confirm"); assert.equal(r.personId, "p1");
  assert.match(r.warning, /Ada Test/); assert.match(r.warning, /BOB OTHER/);
});

test("no matricule held, one name match: confirm on the open row, warns on a different real matricule", () => {
  const rows = [emp({ id: "old", matricule: "QS-0000", status: "ended", start_date: "2020-01-01" }), emp({ id: "cur", matricule: "26", start_date: "2024-01-01" })];
  let r = one(pdf({ matricule: "00099" }), rows);
  assert.equal(r.status, "confirm"); assert.equal(r.employeeIdForMatricule, "cur"); assert.match(r.warning, /26/);
  r = one(pdf({ matricule: "00099" }), [emp({ matricule: "QS-0000" })]);
  assert.equal(r.status, "confirm"); assert.equal(r.warning, null);
  r = one(pdf({ matricule: "00099" }), [emp({ id: "a", status: "ended", start_date: "2020-01-01", matricule: "QS-0000" }), emp({ id: "b", status: "ended", start_date: "2022-01-01", matricule: "QS-0000" })]);
  assert.equal(r.employeeIdForMatricule, "b");
});

test("unknown when nothing or several people match", () => {
  assert.equal(one(pdf({ matricule: "00099", nameFromFile: "NOBODY HERE" }), [emp()]).status, "unknown");
  const two = [emp({ matricule: "1" }), emp({ id: "e2", person_id: "p2", matricule: "2" })];
  const r = one(pdf({ matricule: "00099" }), two);
  assert.equal(r.status, "unknown"); assert.equal(r.personId, null);
});

test("unreadable inputs keep their place", () => {
  const rows = matchPayslips([{ fileName: "bad.pdf", error: "nope" }, pdf()], [emp()], []);
  assert.equal(rows[0].status, "unreadable"); assert.equal(rows[0].personId, null); assert.equal(rows[0].printedName, "");
  assert.equal(rows[1].status, "matched");
});

test("_1 and _2 are both matched; a repeated _1 is a duplicate", () => {
  const rows = matchPayslips([pdf({ index: 1 }), pdf({ index: 2 }), pdf({ index: 1, fileName: "y.pdf" })], [emp()], []);
  assert.deepEqual(rows.map((r) => r.status), ["matched", "matched", "duplicate"]);
});

test("already filed vs changed, compared by person, period, title and sha256", () => {
  const filed = [{ id: "d1", person_id: "p1", valid_from: "2026-10-01", title: payslipTitle("2026-10", 1), sha256: "aa" }];
  assert.equal(one(pdf(), [emp()], filed).status, "already-filed");
  const c = one(pdf({ sha256: "bb" }), [emp()], filed);
  assert.equal(c.status, "changed"); assert.equal(c.supersedes, "d1");
  assert.equal(one(pdf({ index: 2, sha256: "bb" }), [emp()], filed).status, "matched");
  assert.equal(one(pdf({ period: "2026-09" }), [emp()], filed).status, "matched");
});
