import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../src/Devices.Simulator.Web/wwwroot/vendor/three.module.js';
import { createDesignFloorSlab, createFloorSlab, createFloorStairLandings, createFloorStairs, createIncomingFloorStairs, positionDesignStairs } from '../src/Devices.Simulator.Web/wwwroot/building-stairs.mjs';
import { createDesignDoors, createDesignWalkways, createFloorWalkway, createOpenDoor, designWalkwayWidth, roomWallSegments } from '../src/Devices.Simulator.Web/wwwroot/building-access.mjs';
import { createDesignFloorPillars } from '../src/Devices.Simulator.Web/wwwroot/building-pillars.mjs';
import { floorRoomLayout } from '../src/Devices.Simulator.Web/wwwroot/room-fixtures.mjs';

const layouts = [
  [1, ['main', 'office-a', 'office-b']],
  [2, ['main', 'office-a']],
  [3, ['main', 'office-a', 'office-b']],
  [4, ['main']],
  [2, ['main', 'office-a', 'office-b']],
  [4, ['main', 'office-a', 'office-b']]
];

function wallMeshes(area) {
  return roomWallSegments(area).map(({ x1, z1, x2, z2, y, height }) => {
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(Math.hypot(x2 - x1, z2 - z1), height, 0.12),
      new THREE.MeshBasicMaterial());
    wall.position.set((x1 + x2) / 2, y + height / 2, (z1 + z2) / 2);
    wall.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
    wall.updateMatrixWorld();
    return wall;
  });
}

test('edited rooms show openings on each wall and support rooms without doors', () => {
  const area = { x: 0, z: 0, width: 4, depth: 4, doors: [
    { side: 'front', center: 0 }, { side: 'left', center: 0 },
    { side: 'back', center: 0 }, { side: 'right', center: 0 }
  ] };
  const walls = wallMeshes(area);
  for (const [origin, direction] of [
    [new THREE.Vector3(0, 0.5, -2.5), new THREE.Vector3(0, 0, 1)],
    [new THREE.Vector3(0, 0.5, 2.5), new THREE.Vector3(0, 0, -1)],
    [new THREE.Vector3(-2.5, 0.5, 0), new THREE.Vector3(1, 0, 0)],
    [new THREE.Vector3(2.5, 0.5, 0), new THREE.Vector3(-1, 0, 0)]
  ]) {
    assert.equal(new THREE.Raycaster(origin, direction, 0, 1).intersectObjects(walls).length, 0);
  }
  assert.equal(createDesignDoors(area, 0).length, 4);
  assert.equal(roomWallSegments({ ...area, doors: [] }).length, 4);
});

test('edited building dimensions determine the floor slab footprint', () => {
  const slab = createDesignFloorSlab(2.45, 20, 12);
  const bounds = new THREE.Box3().setFromObject(slab);
  assert.equal(bounds.max.x - bounds.min.x, 20);
  assert.equal(bounds.max.z - bounds.min.z, 12);
});

test('edited access stays outside the footprint and joins the rear walkway on every floor', () => {
  const epsilon = 1e-6;
  for (const [width, depth] of [[2, 2], [2, 100], [100, 2], [20, 12], [100, 100]]) {
    for (let floor = 1; floor <= 10; floor++) {
      const y = (floor - 1) * 2.45;
      const walkways = createDesignWalkways(y, width, depth);
      const landing = positionDesignStairs(createFloorStairLandings(y, floor)[0], depth, designWalkwayWidth);
      const flight = positionDesignStairs(createFloorStairs(y, floor === 10, true, floor), depth, designWalkwayWidth);
      const incoming = positionDesignStairs(createIncomingFloorStairs(y, floor), depth, designWalkwayWidth);
      const pillars = createDesignFloorPillars(y, floor === 10, width, depth, designWalkwayWidth);
      flight.updateMatrixWorld(true);
      const outside = object => {
        const bounds = new THREE.Box3().setFromObject(object);
        assert.ok(bounds.max.x <= -width / 2 + epsilon || bounds.min.x >= width / 2 - epsilon ||
          bounds.max.z <= -depth / 2 + epsilon || bounds.min.z >= depth / 2 - epsilon);
      };
      for (const object of [...walkways, landing, ...flight.children, ...pillars.children]) outside(object);
      incoming.updateMatrixWorld(true);
      for (const step of incoming.children) outside(step);
      const rear = new THREE.Box3().setFromObject(walkways[0]);
      const landingBounds = new THREE.Box3().setFromObject(landing);
      assert.ok(Math.abs(rear.min.z - landingBounds.max.z) < epsilon);
      assert.ok(rear.max.x > landingBounds.min.x && rear.min.x < landingBounds.max.x);
      for (const staircase of [flight, incoming]) {
        for (const step of staircase.children) {
          const stepBounds = new THREE.Box3().setFromObject(step);
          for (const pillar of pillars.children) {
            assert.ok(!stepBounds.intersectsBox(new THREE.Box3().setFromObject(pillar)));
          }
        }
      }
      assert.equal(flight.children.length, floor === 10 ? 0 : 18);
      assert.equal(incoming.children.length, floor === 1 ? 0 : 10);
      assert.equal(createFloorStairs(y, floor === 10, false, floor).children.length, floor === 10 ? 0 : 10);
      for (const pillar of pillars.children) {
        const bounds = new THREE.Box3().setFromObject(pillar);
        for (const walkway of walkways) {
          const other = new THREE.Box3().setFromObject(walkway);
          assert.ok(!bounds.intersectsBox(other) ||
            Math.min(bounds.max.x, other.max.x) - Math.max(bounds.min.x, other.min.x) < epsilon ||
            Math.min(bounds.max.z, other.max.z) - Math.max(bounds.min.z, other.min.z) < epsilon);
        }
      }
    }
  }
});

test('one-floor edited buildings have a landing but no outgoing or incoming stairs', () => {
  const landing = positionDesignStairs(createFloorStairLandings(0, 1)[0], 2, designWalkwayWidth);
  const walkway = createDesignWalkways(0, 2, 2)[0];
  assert.ok(Math.abs(new THREE.Box3().setFromObject(landing).max.z -
    new THREE.Box3().setFromObject(walkway).min.z) < 1e-6);
  assert.equal(createFloorStairs(0, true, true, 1).children.length, 0);
  assert.equal(createFloorStairs(0, true, false, 1).children.length, 0);
  assert.equal(createIncomingFloorStairs(0, 1).children.length, 0);
});

test('exterior stair ends contact both landings without crossing the edited slabs', () => {
  const epsilon = 1e-6;
  for (const [width, depth] of [[2, 2], [20, 12], [100, 100]]) {
    for (let floor = 1; floor < 10; floor++) {
      const lowerY = (floor - 1) * 2.45;
      const upperY = floor * 2.45;
      const place = object => positionDesignStairs(object, depth, designWalkwayWidth);
      const lower = new THREE.Box3().setFromObject(place(createFloorStairLandings(lowerY, floor)[0]));
      const upper = new THREE.Box3().setFromObject(place(createFloorStairLandings(upperY, floor + 1)[0]));
      const slabs = [lowerY, upperY].map(y => new THREE.Box3().setFromObject(createDesignFloorSlab(y, width, depth)));
      const full = place(createFloorStairs(lowerY, false, true, floor));
      const outgoing = place(createFloorStairs(lowerY, false, false, floor));
      const incoming = place(createIncomingFloorStairs(upperY, floor + 1));
      for (const group of [full, outgoing, incoming]) group.updateMatrixWorld(true);
      const contact = (step, landing) => {
        const bounds = new THREE.Box3().setFromObject(step);
        const gap = floor % 2 === 1
          ? bounds.min.x - landing.max.x
          : landing.min.x - bounds.max.x;
        assert.ok(Math.abs(gap) < epsilon, `floor ${floor} lower landing gap ${gap}`);
        assert.ok(bounds.min.z < landing.max.z && bounds.max.z > landing.min.z);
        assert.ok(Math.abs(bounds.min.y - landing.max.y) < epsilon);
      };
      contact(full.children[0], lower);
      contact(outgoing.children[0], lower);
      const upperContact = step => {
        const bounds = new THREE.Box3().setFromObject(step);
        const gap = floor % 2 === 1
          ? upper.min.x - bounds.max.x
          : bounds.min.x - upper.max.x;
        assert.ok(Math.abs(gap) < epsilon, `floor ${floor} upper landing gap ${gap}`);
        assert.ok(bounds.min.z < upper.max.z && bounds.max.z > upper.min.z);
        assert.ok(Math.abs(bounds.max.y - upper.max.y) < epsilon);
      };
      upperContact(full.children.at(-1));
      upperContact(incoming.children.at(-1));
      for (const landing of [lower, upper]) {
        for (const slab of slabs) assert.ok(!landing.intersectsBox(slab), `floor ${floor} landing overlaps slab`);
      }
      for (const group of [full, outgoing, incoming]) {
        for (const step of group.children) {
          const bounds = new THREE.Box3().setFromObject(step);
          for (const slab of slabs) assert.ok(!bounds.intersectsBox(slab), `floor ${floor} stair overlaps slab`);
        }
      }
    }
  }
});

test('edited perimeter walkways meet each edge and corner doors remain within their rooms', () => {
  const width = 2, depth = 2;
  const walkways = createDesignWalkways(0, width, depth).map(walkway => new THREE.Box3().setFromObject(walkway));
  for (const [x, z] of [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, 1]]) {
    assert.ok(walkways.some(box => x >= box.min.x - 1e-6 && x <= box.max.x + 1e-6 &&
      z >= box.min.z - 1e-6 && z <= box.max.z + 1e-6));
  }
  const area = { x: 0, z: 0, width, depth, doors: [
    { side: 'front', center: -1 }, { side: 'back', center: 1 },
    { side: 'left', center: -1 }, { side: 'right', center: 1 }
  ] };
  for (const door of createDesignDoors(area, 0)) {
    const bounds = new THREE.Box3().setFromObject(door);
    // The thin door leaf is centered on its hinge at the wall.
    assert.ok(bounds.min.x >= -1.031 && bounds.max.x <= 1.031);
    assert.ok(bounds.min.z >= -1.031 && bounds.max.z <= 1.031);
  }
});

test('each room has an unobstructed doorway between its interior and the rear walkway', () => {
  for (const [floor, keys] of layouts) {
    const layout = floorRoomLayout(floor, keys);
    const walkway = createFloorWalkway(0);
    const walkBounds = new THREE.Box3().setFromObject(walkway);
    for (const area of Object.values(layout)) {
      const { side, center } = area.door;
      const x = side === 'front' ? center : area.x + area.width / 2;
      const z = side === 'front' ? area.z - area.depth / 2 : center;
      assert.ok(x >= walkBounds.min.x && x <= walkBounds.max.x);
      assert.ok(z >= walkBounds.min.z - 1e-10 && z <= walkBounds.max.z + 1e-10);
      const walls = wallMeshes(area);
      const origin = side === 'front' ? new THREE.Vector3(x, 0.5, z - 0.5) : new THREE.Vector3(x + 0.5, 0.5, z);
      const direction = side === 'front' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(-1, 0, 0);
      const ray = new THREE.Raycaster(origin, direction, 0, 1);
      const door = createOpenDoor(area, 0);
      door.updateMatrixWorld();
      assert.equal(ray.intersectObjects([...walls, door]).length, 0,
        `floor ${floor} ${area.label} doorway is obstructed`);
    }
  }
});

test('every doorway has an unobstructed route to its floor landing', () => {
  for (const [floor, keys] of layouts) {
    const rooms = Object.values(floorRoomLayout(floor, keys));
    const obstacles = rooms.flatMap(area => [...wallMeshes(area), createOpenDoor(area, 0)]);
    obstacles.push(...createFloorStairs(0, floor === 4, true, floor).children);
    for (const obstacle of obstacles) obstacle.updateMatrixWorld();
    const landing = createFloorStairLandings(0, floor)[0];
    const corridorZ = createFloorWalkway(0).position.z;
    const clear = (from, to) => {
      const direction = new THREE.Vector3().subVectors(to, from);
      const distance = direction.length();
      if (distance === 0) return true;
      return new THREE.Raycaster(from, direction.normalize(), 0, distance)
        .intersectObjects(obstacles).length === 0;
    };
    const landingPoint = new THREE.Vector3(landing.position.x, 0.5, landing.position.z);
    const junction = new THREE.Vector3(landing.position.x, 0.5, corridorZ);
    assert.ok(clear(landingPoint, junction), `floor ${floor} landing does not connect to corridor`);
    for (const area of rooms) {
      const { side, center } = area.door;
      const doorX = side === 'front' ? center : area.x + area.width / 2;
      const doorZ = side === 'front' ? area.z - area.depth / 2 : center;
      const hall = new THREE.Vector3(doorX, 0.5, corridorZ);
      const inside = side === 'front'
        ? new THREE.Vector3(doorX, 0.5, doorZ + 0.25)
        : new THREE.Vector3(doorX - 0.25, 0.5, doorZ);
      assert.ok(clear(junction, hall) && clear(hall, inside), `floor ${floor} ${area.label} route is obstructed`);
    }
  }
});

test('walkways join the stair landings without bridging the stairwell opening', () => {
  for (const floor of [1, 2, 3, 4]) {
    const walkway = createFloorWalkway(0);
    const landing = createFloorStairLandings(0, floor)[0];
    const walkBounds = new THREE.Box3().setFromObject(walkway);
    const landingBounds = new THREE.Box3().setFromObject(landing);
    assert.ok(walkBounds.max.x > landingBounds.min.x && walkBounds.min.x < landingBounds.max.x);
    assert.ok(Math.abs(walkBounds.min.z - landingBounds.max.z) < 1e-6);
    const slabs = createFloorSlab(0, floor > 1);
    for (const slab of slabs) slab.updateMatrixWorld();
    for (const x of [0.2, 1.2, 2.2, 3.2, 4.2]) {
      const ray = new THREE.Raycaster(new THREE.Vector3(x, 1, (walkBounds.min.z + walkBounds.max.z) / 2),
        new THREE.Vector3(0, -1, 0));
      assert.ok(ray.intersectObjects(slabs).length > 0, `floor ${floor} walkway lacks a supporting slab at x=${x}`);
    }
  }
});
