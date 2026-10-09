import { test } from "node:test";
import assert from "node:assert/strict";
import { autoPanVelocity, draggedPosition, zoomPanAtPoint } from "../apps/intelligence/src/relationshipCanvasMath.ts";

test("cards can move to any world coordinate without clamping", () => {
  assert.deepEqual(
    draggedPosition({ x: 100, y: 100 }, { x: 300, y: 300 }, { x: -200, y: 1200 }, { x: 0, y: 0 }, { x: 0, y: 0 }, 1),
    { x: -400, y: 1000 },
  );
});

test("edge panning keeps a dragged card under the pointer", () => {
  const bounds = { left: 0, right: 1000, top: 0, bottom: 700, width: 1000, height: 700 };
  assert.deepEqual(autoPanVelocity({ x: 500, y: 350 }, bounds), { x: 0, y: 0 });
  assert.ok(autoPanVelocity({ x: 995, y: 695 }, bounds).x < 0);
  assert.ok(autoPanVelocity({ x: 5, y: 5 }, bounds).y > 0);

  const position = draggedPosition({ x: 400, y: 300 }, { x: 500, y: 350 }, { x: 995, y: 695 }, { x: 0, y: 0 }, { x: -18, y: -18 }, 1);
  assert.deepEqual(position, { x: 913, y: 663 });
});

test("pinch zoom keeps the world point under two fingers anchored", () => {
  const pointer = { x: 420, y: 260 };
  const currentPan = { x: 40, y: -20 };
  const nextPan = zoomPanAtPoint(currentPan, 1, 1.5, pointer);

  assert.deepEqual(nextPan, { x: -150, y: -160 });
  assert.deepEqual({
    x: nextPan.x + ((pointer.x - currentPan.x) / 1) * 1.5,
    y: nextPan.y + ((pointer.y - currentPan.y) / 1) * 1.5,
  }, pointer);
});
