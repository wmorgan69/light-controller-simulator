import { test } from 'node:test';
import assert from 'node:assert/strict';
import { designControllerPosition, designRoomView, syncRunningDesign } from '../src/Devices.BuildingControl.Web/frontend/scene/building-design-view.ts';

test('running revision changes refresh the displayed building and failures remain retryable', async () => {
  let displayed = 1;
  let attempts = 0;
  const refresh = async () => {
    attempts++;
    if (attempts === 1) throw new Error('unavailable');
    displayed = 2;
  };
  await syncRunningDesign(1, displayed, refresh);
  assert.equal(attempts, 0);
  await assert.rejects(syncRunningDesign(2, displayed, refresh), /unavailable/);
  await syncRunningDesign(2, displayed, refresh);
  assert.equal(displayed, 2);
  await syncRunningDesign(2, displayed, refresh);
  assert.equal(attempts, 2);
});

test('maps room, doors and fixtures from building coordinates to the centered scene', () => {
  const design = { width: 20, depth: 10 };
  const room = {
    x: 2, z: 1, width: 4, depth: 3,
    doors: [{ x: 3, z: 1 }, { x: 6, z: 2 }, { x: 4, z: 4 }, { x: 2, z: 3 }],
    sensor: { x: 4, z: 2 }, lights: [{ x: 3, z: 2 }, { x: 5, z: 3 }]
  };
  const result = designRoomView(design, room, 2.45);
  assert.deepEqual(result.area, {
    x: -6, z: -2.5, width: 4, depth: 3,
    doors: [
      { side: 'front', center: -7 }, { side: 'right', center: -3 },
      { side: 'back', center: -6 }, { side: 'left', center: -2 }
    ]
  });
  assert.deepEqual(result.fixtures.lights.map(({ x, z }) => ({ x, z })), [{ x: -7, z: -3 }, { x: -5, z: -2 }]);
  assert.deepEqual(designControllerPosition(design, { controllerX: 1, controllerZ: 2 }, 0),
    { x: -9, y: 0.38, z: -3 });
});
