import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lightVisualState, sensorFaultForRoom } from '../src/Devices.Simulator.Web/wwwroot/room-state.mjs';

test('finds only the selected room sensor fault', () => {
  const officeFault = { id: 'fault-a', scope: 'sensor', targetId: 'sensor-floor-4-office-a' };
  const controller = {
    floor: 4,
    faults: [officeFault, { id: 'light', scope: 'light', targetId: 'sensor-floor-4-main' }]
  };
  assert.equal(sensorFaultForRoom(controller, { id: 'floor-4-office-a' }), officeFault);
  assert.equal(sensorFaultForRoom(controller, { id: 'floor-4-main' }), undefined);
  assert.equal(sensorFaultForRoom(controller, { id: 'floor-4-office-b' }), undefined);
  controller.faults = [];
  assert.equal(sensorFaultForRoom(controller, { id: 'floor-4-office-a' }), undefined);
});

test('light visuals follow each strip state rather than a room sensor fault', () => {
  const controller = {
    floor: 4,
    faults: [{ id: 'sensor', scope: 'sensor', targetId: 'sensor-floor-4-main' }]
  };
  const room = { id: 'floor-4-main' };
  assert.ok(sensorFaultForRoom(controller, room));
  assert.deepEqual(lightVisualState({ isOn: true, isFaulted: false }), {
    color: '#fde047', emissive: '#a16207', emissiveIntensity: 0.6
  });
  assert.deepEqual(lightVisualState({ isOn: false, isFaulted: false }), {
    color: '#64748b', emissive: '#000000', emissiveIntensity: 0
  });
  assert.deepEqual(lightVisualState({ isOn: false, isFaulted: true }), {
    color: '#ef4444', emissive: '#7f1d1d', emissiveIntensity: 0.6
  });
});
