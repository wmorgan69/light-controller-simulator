import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../src/Devices.Simulator.Web/wwwroot/vendor/three.module.js';
import { createFloorSlab, createFloorStairLandings, createFloorStairs } from '../src/Devices.Simulator.Web/wwwroot/building-stairs.mjs';
import { createFloorWalkway, createOpenDoor, roomWallSegments } from '../src/Devices.Simulator.Web/wwwroot/building-access.mjs';
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
