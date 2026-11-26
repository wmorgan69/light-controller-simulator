import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  createDesignFloorSlabWithOpenings,
  createDesignStair,
  createDesignWalkway
} from '../../src/Devices.BuildingControl.Web/frontend/scene/building-placeable-access.ts';
import {
  createDesignWalkways,
  createFloorWalkway,
  designWalkwayWidth
} from '../../src/Devices.BuildingControl.Web/frontend/scene/building-access.ts';
import {
  createFloorStairLandings,
  createFloorStairs,
  positionDesignStairs
} from '../../src/Devices.BuildingControl.Web/frontend/scene/building-stairs.ts';
import { materializeLegacyAccess } from '../../src/Devices.BuildingControl.Web/frontend/shared/building-editor-access.ts';

const stair = {
  id: 'stair-1', x: 2, z: 3, width: 2, depth: 4, direction: 'east'
};

function boundsFor(objects) {
  return objects.map(object => {
    const bounds = new THREE.Box3().setFromObject(object);
    return [bounds.min.x, bounds.min.y, bounds.min.z, bounds.max.x, bounds.max.y, bounds.max.z];
  }).sort((left, right) => left[0] - right[0] || left[1] - right[1] || left[2] - right[2]);
}

function assertSameBounds(actual, expected) {
  const actualBounds = boundsFor(actual);
  const expectedBounds = boundsFor(expected);
  assert.equal(actualBounds.length, expectedBounds.length);
  for (let index = 0; index < actualBounds.length; index++) {
    for (let axis = 0; axis < 6; axis++) {
      assert.ok(Math.abs(actualBounds[index][axis] - expectedBounds[index][axis]) < 1e-6,
        `bounds ${index} axis ${axis}: ${actualBounds[index][axis]} != ${expectedBounds[index][axis]}`);
    }
  }
}

function assertSameFootprints(actual, expected) {
  const actualBounds = boundsFor(actual);
  const expectedBounds = boundsFor(expected);
  assert.equal(actualBounds.length, expectedBounds.length);
  for (let index = 0; index < actualBounds.length; index++) {
    for (const axis of [0, 2, 3, 5]) {
      assert.ok(Math.abs(actualBounds[index][axis] - expectedBounds[index][axis]) < 1e-6,
        `footprint ${index} axis ${axis}: ${actualBounds[index][axis]} != ${expectedBounds[index][axis]}`);
    }
  }
}

test('placeable access converts absolute design coordinates and creates connecting stair flights', () => {
  const walkway = createDesignWalkway(
    { id: 'walkway-1', x: 1, z: 2, width: 3, depth: 1 }, 12, 10, 2.45);
  assert.deepEqual(walkway.position.toArray(), [-3.5, 2.45, -2.5]);
  const walkwaySize = new THREE.Box3().setFromObject(walkway).getSize(new THREE.Vector3());
  assert.ok(Math.abs(walkwaySize.x - 3) < 1e-6);
  assert.ok(Math.abs(walkwaySize.y - 0.06) < 1e-6);
  assert.ok(Math.abs(walkwaySize.z - 1) < 1e-6);

  const full = createDesignStair(stair, 12, 10, 0, 'full');
  const bounds = new THREE.Box3().setFromObject(full);
  assert.equal(full.children.length, 18);
  assert.ok(Math.abs(bounds.min.x + 4) < 1e-6);
  assert.ok(Math.abs(bounds.max.x + 2) < 1e-6);
  assert.ok(Math.abs(bounds.min.z + 2) < 1e-6);
  assert.ok(Math.abs(bounds.max.z - 2) < 1e-6);
  assert.ok(Math.abs(bounds.min.y) < 1e-6);
  assert.ok(Math.abs(bounds.max.y - 2.45) < 1e-6);
  assert.equal(full.children[0].userData.treadIndex, 0);
  assert.equal(full.children.at(-1).userData.treadIndex, 17);

  const outgoing = createDesignStair(stair, 12, 10, 0, 'outgoing');
  const incoming = createDesignStair(stair, 12, 10, 0, 'incoming');
  assert.equal(outgoing.children.length, 10);
  assert.equal(incoming.children.length, 10);
  assert.equal(outgoing.children.at(-1).userData.treadIndex, 9);
  assert.equal(incoming.children[0].userData.treadIndex, 8);
  assert.ok(Math.abs(new THREE.Box3().setFromObject(incoming).max.y - 2.45) < 1e-6);

  const westbound = createDesignStair({ ...stair, direction: 'west' }, 12, 10, 0, 'full');
  assert.ok(westbound.children[0].position.x > westbound.children.at(-1).position.x);
});

test('upper floor slab openings follow stairs and overlapping openings are unioned', () => {
  const opening = [
    stair,
    { id: 'stair-2', x: 3, z: 4, width: 2, depth: 3, direction: 'west' }
  ];
  const slabs = createDesignFloorSlabWithOpenings(2.45, 12, 10, opening);
  const world = new THREE.Group();
  world.add(...slabs);
  world.updateMatrixWorld(true);
  const rayHits = (x, z) => new THREE.Raycaster(
    new THREE.Vector3(x, 3, z), new THREE.Vector3(0, -1, 0), 0, 2
  ).intersectObjects(slabs).length;

  assert.equal(rayHits(-3, -1), 0);
  assert.equal(rayHits(-2.5, 0), 0);
  assert.ok(rayHits(0, 0) > 0);
  assert.ok(slabs.every(slab => {
    const bounds = new THREE.Box3().setFromObject(slab);
    return bounds.max.x - bounds.min.x > 0 && bounds.max.z - bounds.min.z > 0;
  }));
});

test('no explicit openings retain the original solid floor slab', () => {
  const [slab] = createDesignFloorSlabWithOpenings(0, 12, 10, []);
  const bounds = new THREE.Box3().setFromObject(slab);
  assert.deepEqual([bounds.min.x, bounds.max.x, bounds.min.z, bounds.max.z], [-6, 6, -5, 5]);
});

test('materialized baseline access matches legacy walkway, landing, and stair geometry', () => {
  for (const [width, depth] of [[10, 8], [20, 20]]) {
    const design = {
      revision: 1, width, depth,
      floors: Array.from({ length: 4 }, (_, index) => ({ number: index + 1 }))
    };
    let nextId = 0;
    materializeLegacyAccess(design, prefix => `${prefix}-${++nextId}`);
    for (let floor = 1; floor <= 4; floor++) {
      const y = (floor - 1) * 2.45;
      const actualFloor = design.floors[floor - 1];
      const walkways = actualFloor.walkways.map(walkway => createDesignWalkway(walkway, width, depth, y));
      const legacyLanding = createFloorStairLandings(y, floor)[0];
      assertSameFootprints(walkways, [createFloorWalkway(y), legacyLanding]);

      const explicit = floor < 4 ? createDesignStair(actualFloor.stairs[0], width, depth, y, 'full') : new THREE.Group();
      const legacy = createFloorStairs(y, floor === 4, true, floor);
      legacy.updateMatrixWorld(true);
      assertSameBounds(explicit.children, legacy.children);
    }
  }
});

test('materialized edited-design access matches legacy perimeter walkways and alternating stairs', () => {
  const width = 20;
  const depth = 12;
  for (let floor = 1; floor <= 4; floor++) {
    const y = (floor - 1) * 2.45;
    const odd = floor % 2 === 1;
    const explicitWalkways = [
      { id: 'front', x: -1.2, z: -1.2, width: width + 2.4, depth: 1.2 },
      { id: 'back', x: -1.2, z: depth, width: width + 2.4, depth: 1.2 },
      { id: 'left', x: -1.2, z: 0, width: 1.2, depth },
      { id: 'right', x: width, z: 0, width: 1.2, depth },
      {
        id: 'landing', x: width / 2 + (odd ? -2.02 : 1.2), z: -3.01, width: 0.82, depth: 1.81
      }
    ].map(walkway => createDesignWalkway(walkway, width, depth, y));
    const legacyWalkways = createDesignWalkways(y, width, depth);
    legacyWalkways.push(positionDesignStairs(createFloorStairLandings(y, floor)[0], depth, designWalkwayWidth));
    assertSameFootprints(explicitWalkways, legacyWalkways);

    const explicit = floor < 4 ? createDesignStair({
      id: 'stair', x: width / 2 - 1.2, z: odd ? -2.96 : -2.05,
      width: 2.4, depth: 0.8, direction: odd ? 'east' : 'west'
    }, width, depth, y, 'full') : new THREE.Group();
    const legacy = positionDesignStairs(createFloorStairs(y, floor === 4, true, floor), depth, designWalkwayWidth);
    legacy.updateMatrixWorld(true);
    assertSameBounds(explicit.children, legacy.children);
  }
});
