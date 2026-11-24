import * as THREE from './vendor/three.module.js';
import { stairwellFront } from './building-stairs.mjs?v=stairs-11';

const wallHeight = 1.2;
const doorWidth = 0.75;
const doorHeight = 0.9;
const walkwayFront = -1.4;
export const designWalkwayWidth = 1.2;

export function roomWallSegments(area) {
  if (area.doors) return designWallSegments(area);
  const left = area.x - area.width / 2;
  const right = area.x + area.width / 2;
  const front = area.z - area.depth / 2;
  const back = area.z + area.depth / 2;
  const { side, center } = area.door;
  const walls = [];
  const add = (x1, z1, x2, z2, y = 0, height = wallHeight) =>
    walls.push({ x1, z1, x2, z2, y, height });
  if (side === 'front') {
    add(left, front, center - doorWidth / 2, front);
    add(center + doorWidth / 2, front, right, front);
    add(center - doorWidth / 2, front, center + doorWidth / 2, front, doorHeight, wallHeight - doorHeight);
  } else {
    add(left, front, right, front);
  }
  add(left, back, right, back);
  add(left, front, left, back);
  if (side === 'right') {
    add(right, front, right, center - doorWidth / 2);
    add(right, center + doorWidth / 2, right, back);
    add(right, center - doorWidth / 2, right, center + doorWidth / 2, doorHeight, wallHeight - doorHeight);
  } else {
    add(right, front, right, back);
  }
  return walls;
}

function designWallSegments(area) {
  const left = area.x - area.width / 2;
  const right = area.x + area.width / 2;
  const front = area.z - area.depth / 2;
  const back = area.z + area.depth / 2;
  const walls = [];
  for (const [side, start, end, fixed, horizontal] of [
    ['front', left, right, front, true],
    ['back', left, right, back, true],
    ['left', front, back, left, false],
    ['right', front, back, right, false]
  ]) {
    const add = (from, to, y = 0, height = wallHeight) => {
      if (to <= from) return;
      walls.push(horizontal
        ? { x1: from, z1: fixed, x2: to, z2: fixed, y, height }
        : { x1: fixed, z1: from, x2: fixed, z2: to, y, height });
    };
    const openings = area.doors.filter(door => door.side === side)
      .map(door => [Math.max(start, door.center - doorWidth / 2), Math.min(end, door.center + doorWidth / 2)])
      .filter(([from, to]) => to > from)
      .sort((a, b) => a[0] - b[0]);
    let cursor = start;
    for (const [from, to] of openings) {
      add(cursor, from);
      add(Math.max(cursor, from), to, doorHeight, wallHeight - doorHeight);
      cursor = Math.max(cursor, to);
    }
    add(cursor, end);
  }
  return walls;
}

export function createDesignDoors(area, baseY) {
  return area.doors.map(({ side, center }) => {
    const horizontalWall = side === 'front' || side === 'back';
    const wallCenter = horizontalWall ? area.x : area.z;
    const wallLength = horizontalWall ? area.width : area.depth;
    const start = Math.max(wallCenter - wallLength / 2, center - doorWidth / 2);
    const end = Math.min(wallCenter + wallLength / 2, center + doorWidth / 2);
    const length = end - start;
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(horizontalWall ? 0.06 : length, doorHeight, horizontalWall ? length : 0.06),
      new THREE.MeshStandardMaterial({ color: '#b59a74', roughness: 0.8 }));
    if (horizontalWall) {
      door.position.set(start, baseY + doorHeight / 2,
        area.z + (side === 'front' ? -1 : 1) * (area.depth / 2 - length / 2));
    } else {
      door.position.set(area.x + (side === 'left' ? -1 : 1) * (area.width / 2 - length / 2),
        baseY + doorHeight / 2, start);
    }
    return door;
  });
}

export function createOpenDoor(area, baseY) {
  const { side, center } = area.door;
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(side === 'front' ? 0.06 : doorWidth, doorHeight, side === 'front' ? doorWidth : 0.06),
    new THREE.MeshStandardMaterial({ color: '#b59a74', roughness: 0.8 }));
  if (side === 'front') {
    door.position.set(center - doorWidth / 2, baseY + doorHeight / 2, area.z - area.depth / 2 + doorWidth / 2);
  } else {
    door.position.set(area.x + area.width / 2 - doorWidth / 2, baseY + doorHeight / 2, center - doorWidth / 2);
  }
  return door;
}

export function createFloorWalkway(baseY) {
  const left = -0.1;
  const right = 4.3;
  const walkway = new THREE.Mesh(
    new THREE.BoxGeometry(right - left, 0.06, walkwayFront - stairwellFront),
    new THREE.MeshStandardMaterial({ color: '#64748b', roughness: 0.9 }));
  walkway.position.set((left + right) / 2, baseY, (stairwellFront + walkwayFront) / 2);
  return walkway;
}

export function createDesignWalkways(baseY, width, depth) {
  const w = designWalkwayWidth;
  const material = () => new THREE.MeshStandardMaterial({ color: '#64748b', roughness: 0.9 });
  return [
    [width + 2 * w, w, 0, -(depth + w) / 2],
    [width + 2 * w, w, 0, (depth + w) / 2],
    [w, depth, -(width + w) / 2, 0],
    [w, depth, (width + w) / 2, 0]
  ].map(([xSize, zSize, x, z]) => {
    const walkway = new THREE.Mesh(new THREE.BoxGeometry(xSize, 0.06, zSize), material());
    walkway.position.set(x, baseY, z);
    return walkway;
  });
}
