import * as THREE from './vendor/three.module.js';
import { stairwellFront } from './building-stairs.mjs?v=stairs-7';

const wallHeight = 1.2;
const doorWidth = 0.75;
const doorHeight = 0.9;
const walkwayFront = -1.4;

export function roomWallSegments(area) {
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
