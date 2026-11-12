import assert from "node:assert/strict";
import test from "node:test";
import { buildCells, isOutOfRange, parseISO, toISO } from "../apps/admin/src/date-field-calendar.ts";

const cellFor = (iso) => buildCells(parseISO(iso)).find((d) => toISO(d) === iso);

test("the min and max days themselves stay pickable", () => {
  const min = parseISO("2026-11-02");
  const max = parseISO("2026-12-31");
  assert.equal(isOutOfRange(cellFor("2026-11-02"), min, max), false);
  assert.equal(isOutOfRange(cellFor("2026-12-31"), min, max), false);
});

test("days outside the range are disabled", () => {
  const min = parseISO("2026-11-02");
  const max = parseISO("2026-11-30");
  assert.equal(isOutOfRange(cellFor("2026-11-01"), min, max), true);
  assert.equal(isOutOfRange(buildCells(parseISO("2026-12-01")).find((d) => toISO(d) === "2026-12-01"), min, max), true);
});

test("comparison ignores the time of day on either side", () => {
  const min = new Date(2026, 10, 2, 12);
  assert.equal(isOutOfRange(new Date(2026, 10, 2, 0), min, null), false);
  assert.equal(isOutOfRange(new Date(2026, 10, 2, 23, 59), null, new Date(2026, 10, 2, 0)), false);
  assert.equal(isOutOfRange(new Date(2026, 10, 1, 23, 59), min, null), true);
});

test("cells cover six Monday-first weeks around the month", () => {
  const cells = buildCells(parseISO("2026-11-15"));
  assert.equal(cells.length, 42);
  assert.equal(toISO(cells[0]), "2026-10-26");
  assert.equal(cells[0].getDay(), 1);
});
