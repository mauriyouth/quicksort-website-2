export type Point = { x: number; y: number };
export type Bounds = { left: number; right: number; top: number; bottom: number; width: number; height: number };

export function draggedPosition(origin: Point, startPointer: Point, pointer: Point, originPan: Point, currentPan: Point, zoom: number): Point {
  return {
    x: origin.x + (pointer.x - startPointer.x - (currentPan.x - originPan.x)) / zoom,
    y: origin.y + (pointer.y - startPointer.y - (currentPan.y - originPan.y)) / zoom,
  };
}

export function autoPanVelocity(pointer: Point, bounds: Bounds): Point {
  const edge = Math.min(84, Math.max(48, Math.min(bounds.width, bounds.height) * .12));
  const axisVelocity = (value: number, start: number, end: number) => value < start + edge
    ? Math.min(18, (start + edge - value) * .24)
    : value > end - edge
      ? -Math.min(18, (value - (end - edge)) * .24)
      : 0;
  return {
    x: axisVelocity(pointer.x, bounds.left, bounds.right),
    y: axisVelocity(pointer.y, bounds.top, bounds.bottom),
  };
}
