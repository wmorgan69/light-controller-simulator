import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FloorView, fieldOfViewForAspect, selectedFloorCamera, cameraPresetNeedsUpdate, isFloorVisible, floorNavigation } from '../src/Devices.Simulator.Web/wwwroot/floor-view.mjs';
import { createFloorPillars } from '../src/Devices.Simulator.Web/wwwroot/building-pillars.mjs';

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

test('shows only the selected floor and restores all floors in overview', () => {
  for (const floor of [1, 2, 3, 4]) {
    assert.equal(isFloorVisible(3, floor), floor === 3);
    assert.equal(isFloorVisible(null, floor), true);
  }
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
        for (const x of [-5, 5]) for (const y of [baseY - 0.21, baseY + 1.4]) for (const z of [-4, 4]) {
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
