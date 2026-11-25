import * as THREE from 'three';
import type { StairDesignDto, WalkwayDesignDto } from '../shared/simulator-model.js';

type StairSection = 'full' | 'outgoing' | 'incoming';

const floorHeight = 2.45;
const stepCount = 18;
const sectionStart = 8;
const sectionEnd = 10;

function designOrigin(designWidth: number, designDepth: number): { x: number; z: number } {
  return { x: -designWidth / 2, z: -designDepth / 2 };
}

export function createDesignWalkway(
  walkway: WalkwayDesignDto,
  designWidth: number,
  designDepth: number,
  baseY: number
): THREE.Mesh {
  const origin = designOrigin(designWidth, designDepth);
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(walkway.width, 0.06, walkway.depth),
    new THREE.MeshStandardMaterial({ color: '#64748b', roughness: 0.9 })
  );
  mesh.position.set(origin.x + walkway.x + walkway.width / 2, baseY, origin.z + walkway.z + walkway.depth / 2);
  mesh.userData.walkwayId = walkway.id;
  return mesh;
}

export function createDesignStair(
  stair: StairDesignDto,
  designWidth: number,
  designDepth: number,
  lowerFloorY: number,
  section: StairSection
): THREE.Group {
  const group = new THREE.Group();
  group.userData.stairId = stair.id;
  const origin = designOrigin(designWidth, designDepth);
  const run = stair.width / stepCount;
  const rise = floorHeight / stepCount;
  const start = section === 'incoming' ? sectionStart : 0;
  const end = section === 'outgoing' ? sectionEnd : stepCount;

  for (let index = start; index < end; index++) {
    const height = (index + 1 - start) * rise;
    const x = stair.direction === 'east'
      ? origin.x + stair.x + (index + 0.5) * run
      : origin.x + stair.x + stair.width - (index + 0.5) * run;
    const tread = new THREE.Mesh(
      new THREE.BoxGeometry(run, height, stair.depth),
      new THREE.MeshStandardMaterial({
        color: '#94a3b8',
        roughness: 0.85,
        transparent: section !== 'full',
        opacity: section === 'full' ? 1 : 0.65,
        depthWrite: section === 'full'
      })
    );
    if (section !== 'full') tread.material.userData.preserveTransparency = true;
    tread.position.set(x, lowerFloorY + start * rise + height / 2, origin.z + stair.z + stair.depth / 2);
    tread.userData.stairId = stair.id;
    tread.userData.treadIndex = index;
    group.add(tread);
  }
  return group;
}

export function createDesignFloorSlabWithOpenings(
  baseY: number,
  width: number,
  depth: number,
  openings: readonly StairDesignDto[],
  designWidth = width,
  designDepth = depth
): THREE.Mesh[] {
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  const rectangles = openings
    .map(stair => ({
      left: Math.max(-halfWidth, stair.x - designWidth / 2),
      right: Math.min(halfWidth, stair.x + stair.width - designWidth / 2),
      front: Math.max(-halfDepth, stair.z - designDepth / 2),
      back: Math.min(halfDepth, stair.z + stair.depth - designDepth / 2)
    }))
    .filter(rectangle => rectangle.right > rectangle.left && rectangle.back > rectangle.front);

  if (rectangles.length === 0) {
    return [createSlabTile(baseY, -halfWidth, halfWidth, -halfDepth, halfDepth)];
  }

  const xs = [...new Set([-halfWidth, halfWidth, ...rectangles.flatMap(rectangle => [rectangle.left, rectangle.right])])]
    .sort((a, b) => a - b);
  const zs = [...new Set([-halfDepth, halfDepth, ...rectangles.flatMap(rectangle => [rectangle.front, rectangle.back])])]
    .sort((a, b) => a - b);
  const slabs: THREE.Mesh[] = [];

  for (let xIndex = 0; xIndex < xs.length - 1; xIndex++) {
    for (let zIndex = 0; zIndex < zs.length - 1; zIndex++) {
      const left = xs[xIndex];
      const right = xs[xIndex + 1];
      const front = zs[zIndex];
      const back = zs[zIndex + 1];
      const centerX = (left + right) / 2;
      const centerZ = (front + back) / 2;
      const insideOpening = rectangles.some(rectangle =>
        centerX > rectangle.left && centerX < rectangle.right &&
        centerZ > rectangle.front && centerZ < rectangle.back);
      if (!insideOpening) slabs.push(createSlabTile(baseY, left, right, front, back));
    }
  }
  return slabs;
}

function createSlabTile(baseY: number, left: number, right: number, front: number, back: number): THREE.Mesh {
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(right - left, 0.18, back - front),
    new THREE.MeshStandardMaterial({ color: '#334155', roughness: 0.86 })
  );
  slab.position.set((left + right) / 2, baseY - 0.12, (front + back) / 2);
  return slab;
}
