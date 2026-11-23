import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FloorView, applyFloorMaterialEmphasis, fieldOfViewForAspect, selectedFloorCamera, cameraPresetNeedsUpdate, isFloorVisible, floorNavigation } from '../src/Devices.Simulator.Web/wwwroot/floor-view.mjs';
import { createFloorPillars } from '../src/Devices.Simulator.Web/wwwroot/building-pillars.mjs';
import * as THREE from '../src/Devices.Simulator.Web/wwwroot/vendor/three.module.js';
import { createFloorSlab, createFloorStairLandings, createFloorStairs, createIncomingFloorStairs } from '../src/Devices.Simulator.Web/wwwroot/building-stairs.mjs';

test('places translucent, non-selectable pillars at the four floor corners', () => {
  const group = createFloorPillars(2.45, false);
  assert.equal(group.children.length, 4);
  assert.deepEqual(group.children.map(pillar => [pillar.position.x, pillar.position.z]), [
    [-4.94, -3.94], [-4.94, 3.94], [4.94, -3.94], [4.94, 3.94]
  ]);
  for (const pillar of group.children) {
    assert.equal(pillar.userData.selection, undefined);
    assert.equal(pillar.material.transparent, true);
    assert.ok(pillar.material.opacity > 0 && pillar.material.opacity < 1);
    assert.equal(pillar.material.depthWrite, false);
    assert.equal(pillar.position.y - pillar.geometry.parameters.height / 2, 2.45);
    assert.equal(pillar.position.y + pillar.geometry.parameters.height / 2, 4.9);
  }
});

test('caps the overview pillars at the top floor ceiling', () => {
  const top = createFloorPillars(7.35, true).children[0];
  assert.ok(Math.abs(top.position.y + top.geometry.parameters.height / 2 - 8.55) < 1e-10);
});

test('connects each floor to the next with non-selectable stairs behind the offices', () => {
  const baseY = 2.45;
  const stairs = createFloorStairs(baseY, false, true, 1).children;
  assert.equal(stairs.length, 18);
  for (let index = 0; index < stairs.length; index++) {
    const step = stairs[index];
    assert.equal(step.userData.selection, undefined);
    assert.ok(step.position.z + step.geometry.parameters.depth / 2 < -1.6);
    assert.ok(Math.abs(step.position.y - step.geometry.parameters.height / 2 - baseY) < 1e-10);
    if (index > 0) {
      assert.ok(step.position.x > stairs[index - 1].position.x);
      assert.ok(step.geometry.parameters.height > stairs[index - 1].geometry.parameters.height);
    }
  }
  const last = stairs.at(-1);
  assert.ok(Math.abs(last.position.y + last.geometry.parameters.height / 2 - (baseY + 2.45)) < 1e-10);
  assert.equal(createFloorStairs(baseY, true, true, 4).children.length, 0);
});

test('joins opposite flights on separate lanes with a shared landing', () => {
  for (const floor of [1, 2]) {
    const lower = createFloorStairs((floor - 1) * 2.45, false, true, floor).children;
    const upper = createFloorStairs(floor * 2.45, false, true, floor + 1).children;
    assert.equal(lower.at(-1).position.x, upper[0].position.x);
    assert.equal(lower[0].position.x, upper.at(-1).position.x);
    assert.ok(Math.abs(lower.at(-1).position.z - upper[0].position.z) >= lower[0].geometry.parameters.depth,
      'flights must not occupy the same lane');
    const landings = createFloorStairLandings(floor * 2.45, floor + 1);
    assert.equal(landings.length, 1);
    const landing = landings[0];
    for (const step of [lower.at(-1), upper[0]]) {
      assert.ok(Math.abs(step.position.z - landing.position.z) + step.geometry.parameters.depth / 2
        <= landing.geometry.parameters.depth / 2);
    }
  }
});

test('leaves room for a landing at each end of the shortened stair flight', () => {
  const steps = createFloorStairs(0, false, true, 1).children;
  const first = steps[0];
  const last = steps.at(-1);
  const start = first.position.x - first.geometry.parameters.width / 2;
  const end = last.position.x + last.geometry.parameters.width / 2;
  assert.ok(end - start < 3.8);
  const [left] = createFloorStairLandings(0, 1);
  const [right] = createFloorStairLandings(2.45, 2);
  assert.ok(left.geometry.parameters.width >= 0.6);
  assert.ok(right.geometry.parameters.width >= 0.6);
  assert.ok(Math.abs(start - (left.position.x + left.geometry.parameters.width / 2)) <= 0.03);
  assert.ok(Math.abs((right.position.x - right.geometry.parameters.width / 2) - end) <= 0.03);
  assert.ok(Math.abs(left.position.y + left.geometry.parameters.height / 2) < 1e-10);
  assert.ok(Math.abs(right.position.y + right.geometry.parameters.height / 2 - 2.45) < 1e-10);
});

test('limits the selected-floor stairs to the lower visible flight', () => {
  const baseY = 4.9;
  const steps = createFloorStairs(baseY, false, false, 3).children;
  assert.equal(steps.length, 10);
  const last = steps.at(-1);
  assert.ok(Math.abs(last.position.y + last.geometry.parameters.height / 2 - (baseY + 2.45 * 10 / 18)) < 1e-10);
  assert.equal(createFloorStairs(baseY, true, false, 4).children.length, 0);
});

test('selected floors show translucent stair sections above and below their landing', () => {
  for (const floor of [2, 3]) {
    const baseY = (floor - 1) * 2.45;
    const up = createFloorStairs(baseY, false, false, floor).children;
    const down = createIncomingFloorStairs(baseY, floor).children;
    assert.equal(down.length, 10);
    assert.equal(up.length, 10);
    assert.notEqual(up[0].position.z, down[0].position.z);
    const top = down.at(-1);
    assert.ok(Math.abs(top.position.y + top.geometry.parameters.height / 2 - baseY) < 1e-10);
    assert.ok(down[0].position.y + down[0].geometry.parameters.height / 2 < baseY);
    for (const step of [...up, ...down]) {
      assert.equal(step.material.transparent, true);
      assert.ok(step.material.opacity > 0 && step.material.opacity < 1);
      assert.equal(step.material.userData.preserveTransparency, true);
    }
  }
  assert.equal(createIncomingFloorStairs(0, 1).children.length, 0);
  assert.equal(createIncomingFloorStairs(7.35, 4).children.length, 10);
  assert.equal(createFloorStairs(7.35, true, false, 4).children.length, 0);
  assert.equal(createFloorStairs(0, false, true, 1).children[0].material.transparent, false);
});

test('opens the slab above the full stair flight while preserving the surrounding floor', () => {
  const castDown = (slabs, x, z) => {
    const ray = new THREE.Raycaster(new THREE.Vector3(x, 10, z), new THREE.Vector3(0, -1, 0));
    for (const slab of slabs) slab.updateMatrixWorld();
    return ray.intersectObjects(slabs).length > 0;
  };
  const ground = createFloorSlab(0, false);
  const upper = createFloorSlab(2.45, true);
  for (const floor of [1, 2]) {
    for (const step of createFloorStairs(0, false, true, floor).children) {
      const { width, depth } = step.geometry.parameters;
      for (const x of [step.position.x - width / 2, step.position.x + width / 2]) {
        for (const z of [step.position.z - depth / 2, step.position.z + depth / 2]) {
          assert.equal(castDown(upper, x, z), false, 'upper slab must clear both stair lanes');
        }
      }
    }
  }
  assert.equal(castDown(ground, 2, -2.95), true);
  for (const [x, z] of [[-4.9, -3.9], [4.9, -3.9], [2, -3.9], [2, -1.9], [0, 0]]) {
    assert.equal(castDown(upper, x, z), true, `floor must remain at ${x}, ${z}`);
  }
});

test('the selected top floor fills the unused lane while leaving the descending flight open', () => {
  const slabs = createFloorSlab(7.35, true, 3);
  for (const slab of slabs) slab.updateMatrixWorld();
  const incoming = createFloorStairs(4.9, false, true, 3).children;
  const unused = createFloorStairs(7.35, false, true, 4).children;
  const hasFloor = step => new THREE.Raycaster(
    new THREE.Vector3(step.position.x, 10, step.position.z),
    new THREE.Vector3(0, -1, 0)).intersectObjects(slabs).length > 0;
  for (const step of incoming) assert.equal(hasFloor(step), false, 'descending stairs must remain unobstructed');
  for (const step of unused) assert.equal(hasFloor(step), true, 'unused lane must be covered');
});

test('shows only the selected floor and restores all floors in overview', () => {
  for (const floor of [1, 2, 3, 4]) {
    assert.equal(isFloorVisible(3, floor), floor === 3);
    assert.equal(isFloorVisible(null, floor), true);
  }
});

test('floor emphasis preserves the transparency of light rays', () => {
  const rays = { userData: { preserveTransparency: true }, transparent: true, depthWrite: false };
  applyFloorMaterialEmphasis(rays, false);
  assert.equal(rays.transparent, true);
  assert.equal(rays.depthWrite, false);
  const wall = { userData: {} };
  applyFloorMaterialEmphasis(wall, true);
  assert.equal(wall.opacity, 0.16);
  assert.equal(wall.transparent, true);
  applyFloorMaterialEmphasis(wall, false);
  assert.equal(wall.opacity, 1);
  assert.equal(wall.depthWrite, true);
});

test('orders floor navigation and updates selection, status, and room occupancy', () => {
  const controllers = [
    { id: 'one', floor: 1, status: 'Healthy', rooms: [{ presence: false }, { presence: false }] },
    { id: 'two', floor: 2, status: 'Faulted', rooms: [{ presence: true }, { presence: false }] }
  ];
  assert.deepEqual(floorNavigation(controllers, 2), [
    { id: 'two', floor: 2, status: 'Faulted', selected: true, occupiedRooms: 1, totalRooms: 2 },
    { id: 'one', floor: 1, status: 'Healthy', selected: false, occupiedRooms: 0, totalRooms: 2 }
  ]);
  controllers[1].status = 'Healthy';
  controllers[1].rooms[1].presence = true;
  assert.deepEqual(floorNavigation(controllers, null), [
    { id: 'two', floor: 2, status: 'Healthy', selected: false, occupiedRooms: 2, totalRooms: 2 },
    { id: 'one', floor: 1, status: 'Healthy', selected: false, occupiedRooms: 0, totalRooms: 2 }
  ]);
  assert.equal(controllers[0].id, 'one');
});

test('preserves horizontal framing on narrow screens', () => {
  const radians = degrees => degrees * Math.PI / 180;
  const desktopHorizontal = Math.tan(radians(fieldOfViewForAspect(1.15)) / 2) * 1.15;
  const mobileHorizontal = Math.tan(radians(fieldOfViewForAspect(0.5)) / 2) * 0.5;
  assert.ok(Math.abs(desktopHorizontal - mobileHorizontal) < 1e-10);
  assert.equal(fieldOfViewForAspect(2), fieldOfViewForAspect(1.15));
});

test('zooms selected-floor presets out slightly on desktop without changing mobile framing', () => {
  const distanceFromTarget = ({ position, target }) =>
    Math.hypot(position.x - target.x, position.y - target.y, position.z - target.z);
  for (const floor of [1, 3]) {
    const mobile = selectedFloorCamera(floor, 320);
    const desktop = selectedFloorCamera(floor, 1280);
    assert.deepEqual(desktop.target, mobile.target);
    assert.ok(distanceFromTarget(desktop) / distanceFromTarget(mobile) >= 1.05);
    assert.ok(distanceFromTarget(desktop) / distanceFromTarget(mobile) <= 1.12);
  }
  const mobile = selectedFloorCamera(3, 320);
  assert.deepEqual(selectedFloorCamera(3, 760), mobile);
  assert.ok(distanceFromTarget(selectedFloorCamera(3, 761)) > distanceFromTarget(mobile));
});

test('reframes an active preset only when resizing across the desktop breakpoint', () => {
  assert.equal(cameraPresetNeedsUpdate(760, 761, true), true);
  assert.equal(cameraPresetNeedsUpdate(761, 760, true), true);
  assert.equal(cameraPresetNeedsUpdate(800, 900, true), false);
  assert.equal(cameraPresetNeedsUpdate(760, 761, false), false);
});

test('keeps the selected floor in view on desktop and mobile', () => {
  const normalize = vector => {
    const length = Math.hypot(...vector);
    return vector.map(value => value / length);
  };
  const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
  const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];

  for (const selectedFloor of [1, 2, 3, 4]) {
    for (const [aspect, width] of [[1.25, 1280], [0.5, 320]]) {
      const { position, target } = selectedFloorCamera(selectedFloor, width);
      const forward = normalize([target.x - position.x, target.y - position.y, target.z - position.z]);
      const right = normalize(cross(forward, [0, 1, 0]));
      const up = cross(right, forward);
      const vertical = Math.tan(fieldOfViewForAspect(aspect) * Math.PI / 360);
      {
        const baseY = (selectedFloor - 1) * 2.45;
        const bounds = [];
        for (const x of [-5, 5]) for (const y of [baseY - 0.21, baseY + 1.4]) for (const z of [-4, 4]) {
          bounds.push([x, y, z]);
        }
        if (selectedFloor > 1) {
          for (const x of [1, 3.4]) for (const z of [-3.76, -2.05]) {
            bounds.push([x, baseY - 2.45 * 10 / 18, z]);
          }
        }
        for (const [x, y, z] of bounds) {
          const point = [x - position.x, y - position.y, z - position.z];
          const depth = dot(point, forward);
          assert.ok(depth > 0 && Math.abs(dot(point, right) / (depth * vertical * aspect)) <= 1,
            `floor ${selectedFloor} clips horizontally at aspect ${aspect}`);
          assert.ok(Math.abs(dot(point, up) / (depth * vertical)) <= 1,
            `floor ${selectedFloor} clips vertically at aspect ${aspect}`);
        }
      }
    }
  }
});

test('switches between a selected floor and the overview', () => {
  const view = new FloorView();
  view.select(3);
  assert.equal(view.current, 3);
  view.showAll();
  assert.equal(view.current, null);
  view.select(4);
  assert.equal(view.current, 4);
});
