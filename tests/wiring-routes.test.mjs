import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wiringRoute, isWiringVisible } from '../src/Devices.Simulator.Web/wwwroot/wiring-routes.mjs';
import { FloorView } from '../src/Devices.Simulator.Web/wwwroot/floor-view.mjs';
import { roomFixturePositions, sensorRadius } from '../src/Devices.Simulator.Web/wwwroot/room-fixtures.mjs';

test('places sensors at ceiling height, inside rooms and clear of light strips', () => {
  const areas = [
    { x: -2.4, z: 0, width: 4.7, depth: 7.1, count: 4, lightLength: 1.1 },
    { x: 1.25, z: 0, width: 2.35, depth: 3.2, count: 1, lightLength: 1.7 },
    { x: 3.8, z: 0, width: 2.35, depth: 3.2, count: 1, lightLength: 1.7 }
  ];
  for (const floorY of [0, 7.35]) {
    for (const area of areas) {
      const { sensor, lights, ceiling } = roomFixturePositions(area, floorY, area.count);
      assert.ok(Math.abs(sensor.y + sensorRadius - ceiling) < 1e-10);
      assert.ok(Math.abs(sensor.x - area.x) + sensorRadius < area.width / 2);
      assert.ok(Math.abs(sensor.z - area.z) + sensorRadius < area.depth / 2);
      for (const light of lights) {
        const dx = Math.max(0, Math.abs(sensor.x - light.x) - area.lightLength / 2);
        const dz = Math.max(0, Math.abs(sensor.z - light.z) - 0.22 / 2);
        assert.ok(Math.hypot(dx, dz) > sensorRadius, 'sensor overlaps a light strip');
      }
    }
  }
});

test('routes a device to its floor controller via the ceiling', () => {
  const controller = { x: -4.65, y: 5.28, z: -3.4 };
  const device = { x: 1.25, y: 6.06, z: 0 };
  assert.deepEqual(wiringRoute(controller, device, 6.32), [
    controller,
    { x: -4.65, y: 6.32, z: -3.4 },
    { x: 1.25, y: 6.32, z: -3.4 },
    { x: 1.25, y: 6.32, z: 0 },
    device
  ]);
});

test('does not create zero-length route segments when coordinates coincide', () => {
  const controller = { x: 0, y: 1, z: 0 };
  const device = { x: 0, y: 2, z: 0 };
  assert.deepEqual(wiringRoute(controller, device, 2), [controller, device]);
});

test('automatically shows wiring only on the selected floor', () => {
  assert.equal(isWiringVisible(3, 3), true);
  assert.equal(isWiringVisible(3, 4), false);
  assert.equal(isWiringVisible(4, 3), false);
  assert.equal(isWiringVisible(4, 4), true);
});

test('hides wiring on every floor in the all-floors view', () => {
  assert.equal(isWiringVisible(null, 1), false);
  assert.equal(isWiringVisible(null, 4), false);
});

test('shows wiring again when selecting a floor after all floors', () => {
  const view = new FloorView();
  view.select(3);
  assert.equal(isWiringVisible(view.current, 3), true);
  view.showAll();
  assert.equal(isWiringVisible(view.current, 3), false);
  view.select(3);
  assert.equal(isWiringVisible(view.current, 3), true);
});
