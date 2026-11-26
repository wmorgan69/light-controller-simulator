import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lightEmits, lightVisualState, roomIllumination, selectedRoomVisualState, sensorFaultForRoom, sensorPulseAmount } from '../../src/Devices.BuildingControl.Web/frontend/scene/room-state.ts';

test('a sensor fault changes the sensor, not the selected room walls or floor', () => {
  for (const presence of [false, true]) {
    const healthy = selectedRoomVisualState(presence, false);
    const faulted = selectedRoomVisualState(presence, true);
    assert.equal(faulted.wallColor, healthy.wallColor);
    assert.equal(faulted.surfaceColor, healthy.surfaceColor);
    assert.equal(faulted.outlineColor, healthy.outlineColor);
    assert.notEqual(faulted.sensorColor, healthy.sensorColor);
  }
});

test('idle, active and faulted sensors remain distinct from selected room colours', () => {
  const idle = selectedRoomVisualState(false, false);
  const active = selectedRoomVisualState(true, false);
  const faulted = selectedRoomVisualState(false, true);
  assert.equal(idle.sensorColor, '#f8fafc');
  assert.equal(active.sensorColor, '#22c55e');
  assert.equal(faulted.sensorColor, '#ef4444');
  assert.notEqual(idle.sensorColor, idle.wallColor);
  assert.notEqual(active.sensorColor, active.wallColor);
  assert.notEqual(faulted.sensorColor, faulted.wallColor);
});

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

test('uses the explicit sensor identity for an edited room', () => {
  const fault = { scope: 'sensor', targetId: 'sensor-new-id' };
  const controller = { floor: 1, faults: [fault] };
  assert.equal(sensorFaultForRoom(controller, { id: 'room-new-id', sensorId: 'sensor-new-id' }), fault);
});

test('only faulted sensors pulse, and reduced motion keeps them steady', () => {
  assert.equal(sensorPulseAmount(true, false, 0), 0);
  assert.ok(Math.abs(sensorPulseAmount(true, false, 600) - 0.5) < 1e-10);
  assert.equal(sensorPulseAmount(true, false, 1200), 1);
  assert.equal(sensorPulseAmount(true, false, 2400), 0);
  assert.equal(sensorPulseAmount(false, false, 1200), 0);
  assert.equal(sensorPulseAmount(true, true, 1200), 0);
});

test('room illumination follows working lights, including partial and faulted states', () => {
  const on = { isOn: true, isFaulted: false };
  const off = { isOn: false, isFaulted: false };
  const faulted = { isOn: true, isFaulted: true };
  assert.equal(roomIllumination([]), 0);
  assert.equal(roomIllumination([off, faulted]), 0);
  assert.equal(roomIllumination([on, on]), 1);
  assert.equal(roomIllumination([on, faulted]), 0.5);
  assert.equal(lightEmits(on), true);
  assert.equal(lightEmits(off), false);
  assert.equal(lightEmits(faulted), false);
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
