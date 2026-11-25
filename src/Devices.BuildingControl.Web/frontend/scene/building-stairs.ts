import * as THREE from 'three';

const stairStartX = 1;
const stairRun = 2.4;
const stairLanes = [-3.36, -2.45];
const stairDepth = 0.8;
const stairEndMargin = 0.02;
const landingWidth = 0.8;
const stairwellBack = stairLanes[0] - stairDepth / 2 - 0.05;
export const stairwellFront = stairLanes[1] + stairDepth / 2 + 0.05;
const stepCount = 18;
const sectionSteps = 10;
const floorHeight = 2.45;

export function designStairOffset(depth: number, walkwayWidth: number): { x: number; z: number } {
  return { x: -(stairStartX + stairRun / 2), z: -depth / 2 - walkwayWidth - stairwellFront };
}

function isStairLanding(object: THREE.Object3D): boolean {
  return object.userData.stairLanding === true;
}

export function positionDesignStairs<T extends THREE.Object3D>(object: T, depth: number, walkwayWidth: number): T {
  if (isStairLanding(object)) {
    object.scale.x = (landingWidth + stairEndMargin) / landingWidth;
    object.position.x += object.position.x < stairStartX + stairRun / 2
      ? stairEndMargin / 2 : -stairEndMargin / 2;
  }
  const offset = designStairOffset(depth, walkwayWidth);
  object.position.x += offset.x;
  object.position.z += offset.z;
  return object;
}

export function createDesignFloorSlab(baseY: number, width: number, depth: number): THREE.Mesh {
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(width, 0.18, depth),
    new THREE.MeshStandardMaterial({ color: '#334155', roughness: 0.86 }));
  slab.position.set(0, baseY - 0.12, 0);
  return slab;
}

export function createFloorSlab(baseY: number, hasStairwell: boolean, incomingFloor: number | null = null): THREE.Mesh[] {
  const left = stairStartX - stairEndMargin;
  const right = stairStartX + stairRun + stairEndMargin;
  const incomingLane = incomingFloor === null ? null : stairLanes[(incomingFloor - 1) % 2];
  const back = incomingLane === null ? stairwellBack : incomingLane - stairDepth / 2 - 0.05;
  const front = incomingLane === null ? stairwellFront : incomingLane + stairDepth / 2 + 0.05;
  const rectangles: [number, number, number, number][] = hasStairwell
    ? [[-5, left, -4, 4], [right, 5, -4, 4], [left, right, -4, back], [left, right, front, 4]]
    : [[-5, 5, -4, 4]];

  return rectangles.map(([x1, x2, z1, z2]) => {
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(x2 - x1, 0.18, z2 - z1),
      new THREE.MeshStandardMaterial({ color: '#334155', roughness: 0.86 }));
    slab.position.set((x1 + x2) / 2, baseY - 0.12, (z1 + z2) / 2);
    return slab;
  });
}

export function createFloorStairLandings(baseY: number, floor: number): THREE.Mesh[] {
  const edges = [stairStartX - stairEndMargin, stairStartX + stairRun + stairEndMargin];
  const index = (floor - 1) % 2;
  const landing = new THREE.Mesh(
    new THREE.BoxGeometry(landingWidth, 0.06, stairwellFront - stairwellBack),
    new THREE.MeshStandardMaterial({ color: '#64748b', roughness: 0.85 }));
  landing.userData.stairLanding = true;
  landing.position.set(edges[index] + (index === 0 ? -1 : 1) * landingWidth / 2,
    baseY - 0.03, (stairwellBack + stairwellFront) / 2);
  return [landing];
}

export function createFloorStairs(baseY: number, isTopFloor: boolean, overview: boolean, floor: number): THREE.Group {
  if (isTopFloor) return new THREE.Group();
  return createFlight(baseY, floor, 0, overview ? stepCount : sectionSteps, !overview);
}

export function createIncomingFloorStairs(baseY: number, floor: number): THREE.Group {
  if (floor <= 1) return new THREE.Group();
  return createFlight(baseY - floorHeight, floor - 1, stepCount - sectionSteps, stepCount, true);
}

function createFlight(baseY: number, floor: number, start: number, end: number, sectional: boolean): THREE.Group {
  const group = new THREE.Group();
  const rise = floorHeight / stepCount;
  const run = stairRun / stepCount;
  const bottomY = baseY + start * rise;
  for (let index = start; index < end; index++) {
    const height = (index + 1 - start) * rise;
    const material = new THREE.MeshStandardMaterial({
      color: '#94a3b8', roughness: 0.85,
      transparent: sectional, opacity: sectional ? 0.65 : 1, depthWrite: !sectional
    });
    if (sectional) material.userData.preserveTransparency = true;
    const step = new THREE.Mesh(
      new THREE.BoxGeometry(run, height, stairDepth),
      material);
    const position = floor % 2 === 0 ? stepCount - index - 0.5 : index + 0.5;
    step.position.set(stairStartX + position * run, bottomY + height / 2, stairLanes[(floor - 1) % 2]);
    group.add(step);
  }
  return group;
}
