import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wiringRoute, isWiringVisible } from '../src/Devices.BuildingControl.Web/frontend/scene/wiring-routes.ts';
import { FloorView } from '../src/Devices.BuildingControl.Web/frontend/scene/floor-view.ts';
import { floorRoomLayout, roomFixturePositions, sensorRadius } from '../src/Devices.BuildingControl.Web/frontend/scene/room-fixtures.ts';

test('lays out floor 2 with a larger main room and one office, and floor 4 as one large room', () => {
  const standardRooms = ['main', 'office-a', 'office-b'];
  const floor1 = floorRoomLayout(1, standardRooms);
  const floor2 = floorRoomLayout(2, ['main', 'office-a']);
  const floor3 = floorRoomLayout(3, standardRooms);
  const floor4 = floorRoomLayout(4, ['main']);
  assert.deepEqual(floor1, floor3);
  assert.deepEqual(floorRoomLayout(2, standardRooms), floor3);
  assert.deepEqual(floorRoomLayout(4, standardRooms), floor3);
  assert.deepEqual(Object.keys(floor2), ['main', 'office-a']);
  assert.deepEqual(Object.keys(floor4), ['main']);
  const area = room => room.width * room.depth;
  assert.ok(area(floor2.main) > area(floor3.main));
  assert.ok(area(floor4.main) > area(floor2.main));
  for (const room of [floor2.main, floor4.main]) {
    assert.ok(room.z - room.depth / 2 > -2.4, 'room surface must not cover the stairwell');
  }
});

test('spreads added lights inside enlarged rooms and clear of their sensors', () => {
  for (const [floor, count, columns] of [[2, 8, 4], [4, 12, 6]]) {
    const area = floorRoomLayout(floor, floor === 2 ? ['main', 'office-a'] : ['main']).main;
    const { sensor, lights } = roomFixturePositions(area, 0, count);
    assert.equal(new Set(lights.map(light => `${light.x},${light.z}`)).size, count);
    assert.equal(new Set(lights.map(light => light.z)).size, 2);
    assert.equal(new Set(lights.map(light => light.x)).size, columns);
    for (const light of lights) {
      assert.ok(Math.abs(light.x - area.x) + 0.55 < area.width / 2);
      assert.ok(Math.abs(light.z - area.z) + 0.11 < area.depth / 2);
      const dx = Math.max(0, Math.abs(sensor.x - light.x) - 0.55);
      const dz = Math.max(0, Math.abs(sensor.z - light.z) - 0.11);
      assert.ok(Math.hypot(dx, dz) > sensorRadius);
    }
  }
});

test('places sensors at ceiling height, inside rooms and clear of light strips', () => {
  for (const [floor, counts] of [[1, { main: 6, 'office-a': 1, 'office-b': 1 }],
    [2, { main: 8, 'office-a': 1 }], [4, { main: 12 }]]) {
    const layout = floorRoomLayout(floor, Object.keys(counts));
    const floorY = (floor - 1) * 2.45;
    for (const [key, count] of Object.entries(counts)) {
      const area = layout[key];
      const lightLength = count >= 4 ? 1.1 : 1.7;
      const { sensor, lights, ceiling } = roomFixturePositions(area, floorY, count);
      assert.ok(Math.abs(sensor.y + sensorRadius - ceiling) < 1e-10);
      assert.ok(Math.abs(sensor.x - area.x) + sensorRadius < area.width / 2);
      assert.ok(Math.abs(sensor.z - area.z) + sensorRadius < area.depth / 2);
      assert.equal(new Set(lights.map(light => `${light.x},${light.z}`)).size, count);
      for (const light of lights) {
        assert.ok(Math.abs(light.x - area.x) + lightLength / 2 < area.width / 2);
        assert.ok(Math.abs(light.z - area.z) + 0.22 / 2 < area.depth / 2);
        const dx = Math.max(0, Math.abs(sensor.x - light.x) - lightLength / 2);
        const dz = Math.max(0, Math.abs(sensor.z - light.z) - 0.22 / 2);
        assert.ok(Math.hypot(dx, dz) > sensorRadius, 'sensor overlaps a light strip');
      }
    }
  }
});

test('spreads six main-room lights evenly in two rows of three', () => {
  const { lights } = roomFixturePositions({ x: 0, z: 0 }, 0, 6);
  assert.deepEqual(lights.map(light => [light.x, light.z]), [
    [-1.3, -1.6], [0, -1.6], [1.3, -1.6],
    [-1.3, 1.6], [0, 1.6], [1.3, 1.6]
  ]);
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

test('offsets sensor wiring from light wiring while retaining both endpoints', () => {
  const controller = { x: -4.65, y: 0.38, z: -3.4 };
  const device = { x: 1.25, y: 1.16, z: 0 };
  const light = wiringRoute(controller, device, 1.4);
  const sensor = wiringRoute(controller, device, 1.4, 0.22);
  assert.deepEqual(sensor[0], controller);
  assert.deepEqual(sensor.at(-1), device);
  assert.ok(Math.abs(sensor[4].z - light[2].z - 0.22) < 1e-10);
  assert.equal(sensor[5].x, device.x);
  assert.ok(Math.abs(sensor[4].y - light[2].y - 0.22) < 1e-10);
  for (let index = 1; index < sensor.length; index++) {
    const a = sensor[index - 1];
    const b = sensor[index];
    assert.equal([a.x !== b.x, a.y !== b.y, a.z !== b.z].filter(Boolean).length, 1);
  }
});

test('sensor wires drop vertically to the top of each sensor', () => {
  const controller = { x: -4.65, y: 0.38, z: -3.4 };
  for (const [floor, counts] of [[1, { main: 6, 'office-a': 1, 'office-b': 1 }],
    [2, { main: 8, 'office-a': 1 }], [4, { main: 12 }]]) {
    const layout = floorRoomLayout(floor, Object.keys(counts));
    for (const [key, count] of Object.entries(counts)) {
      const { sensor, sensorConnection, ceiling } = roomFixturePositions(layout[key], 0, count);
      const route = wiringRoute(controller, sensorConnection, ceiling, 0.22);
      const [before, end] = route.slice(-2);
      assert.deepEqual(end, { x: sensor.x, y: sensor.y + sensorRadius, z: sensor.z });
      assert.equal(before.x, sensor.x);
      assert.equal(before.z, sensor.z);
      assert.ok(before.y > end.y);
    }
  }
});

test('sensor routes do not cross light routes for the actual room fixtures', () => {
  const controller = { x: -4.65, y: 0.38, z: -3.4 };
  for (const [floor, roomCounts] of [
    [1, { main: 6, 'office-a': 1, 'office-b': 1 }],
    [2, { main: 8, 'office-a': 1 }],
    [4, { main: 12 }]
  ]) {
    const layout = floorRoomLayout(floor, Object.keys(roomCounts));
    const fixtures = Object.entries(roomCounts).map(([key, count]) => roomFixturePositions(layout[key], 0, count));
    const routes = fixtures.flatMap(fixture => fixture.lights.map(light => wiringRoute(controller, light, 1.4)));
    for (const fixture of fixtures) {
      const sensor = wiringRoute(controller, fixture.sensorConnection, 1.4, 0.22);
      for (const light of routes) {
        for (let i = 1; i < sensor.length; i++) {
          for (let j = 1; j < light.length; j++) {
            const intersection = ['x', 'y', 'z'].map(axis => {
              const low = Math.max(Math.min(sensor[i - 1][axis], sensor[i][axis]), Math.min(light[j - 1][axis], light[j][axis]));
              const high = Math.min(Math.max(sensor[i - 1][axis], sensor[i][axis]), Math.max(light[j - 1][axis], light[j][axis]));
              return { axis, low, high };
            });
            if (intersection.some(({ low, high }) => low > high)) continue;
            assert.ok(intersection.every(({ axis, low, high }) => low === controller[axis] && high === controller[axis]),
              `floor ${floor} sensor and light routes cross outside the controller`);
          }
        }
      }
    }
  }
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
