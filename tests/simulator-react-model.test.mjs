// @vitest-environment node
import assert from 'node:assert/strict';
const { test } = process.env.VITEST ? await import('vitest') : await import('node:test');
import {
  accessibleFaultOptions, accessibleRoomOptions, applyMutationState, controllerForTarget,
  faultForRoom, findRoom, floorStatus, isBuildingView, isDesignStatus, isMutationState, readTransportStatus, roomSensorId,
  refreshDisposition, refreshFailureDisposition, selectionForPointerUp, selectedRoomForFloor
} from '../src/Devices.BuildingControl.Web/frontend/shared/simulator-model.ts';

const controller = {
  id: 'controller-floor-2',
  floor: 2,
  status: 'Healthy',
  lastSeen: '2026-01-01T00:00:00Z',
  rooms: [
    {
      id: 'floor-2-main', name: 'Boardroom', controllerId: 'controller-floor-2',
      sensorId: 'sensor-boardroom', sensorTriggered: true, presence: true,
      lightStrips: [
        { id: 'light-1', roomId: 'floor-2-main', isOn: true, isFaulted: false },
        { id: 'light-2', roomId: 'floor-2-main', isOn: false, isFaulted: false }
      ]
    },
    {
      id: 'floor-2-office-a', name: 'Meeting Office', controllerId: 'controller-floor-2',
      sensorTriggered: false, presence: false,
      lightStrips: [{ id: 'light-3', roomId: 'floor-2-office-a', isOn: false, isFaulted: false }]
    }
  ],
  faults: [{ id: 'fault-sensor', scope: 'sensor', targetId: 'sensor-boardroom', description: 'Test sensor fault' }],
  revision: 3
};
const controllers = [controller];

test('room lookup and sensor-fault selection use stable explicit identities', () => {
  const found = findRoom(controllers, 'floor-2-main');
  assert.equal(found.controller, controller);
  assert.equal(found.room.name, 'Boardroom');
  assert.equal(faultForRoom(controller, found.room), controller.faults[0]);
  assert.equal(roomSensorId(controller, found.room), 'sensor-boardroom');
  assert.equal(findRoom(controllers, 'missing-room'), null);
});

test('legacy rooms without explicit sensor ids retain their floor-derived identity', () => {
  assert.equal(roomSensorId(controller, { id: 'floor-2-office-a' }), 'sensor-floor-2-office-a');
});

test('accessible targets include each room, sensor, strip, and controller exactly once', () => {
  assert.deepEqual(accessibleRoomOptions(controllers).map(item => item.id),
    ['floor-2-main', 'floor-2-office-a']);
  assert.deepEqual(accessibleFaultOptions(controllers, 'sensor').map(item => item.id),
    ['sensor-boardroom', 'sensor-floor-2-office-a']);
  assert.deepEqual(accessibleFaultOptions(controllers, 'light').map(item => item.id),
    ['light-1', 'light-2', 'light-3']);
  assert.deepEqual(accessibleFaultOptions(controllers, 'controller').map(item => item.id),
    ['controller-floor-2']);
  assert.equal(controllerForTarget(controllers, 'light', 'light-3'), controller);
  assert.equal(controllerForTarget(controllers, 'controller', 'missing'), undefined);
});

test('floor summary and default room selection use current controller state', () => {
  assert.deepEqual(floorStatus(controller), { occupied: 1, total: 2 });
  assert.equal(selectedRoomForFloor(controller), controller.rooms[0]);
  assert.equal(selectedRoomForFloor({ rooms: [controller.rooms[1]] }), controller.rooms[1]);
  assert.equal(selectedRoomForFloor(null), null);
});

test('authoritative mutation results replace one controller or the full scenario snapshot', () => {
  const updated = { ...controller, status: 'Faulted', revision: 4 };
  const other = {
    id: 'controller-floor-1', floor: 1, status: 'Healthy', lastSeen: '2026-01-01T00:00:00Z',
    rooms: [], faults: [], revision: 1
  };
  assert.equal(isMutationState(updated), true);
  assert.deepEqual(applyMutationState([other, controller], updated), [other, updated]);

  const scenario = [other, { ...controller, rooms: [] }];
  assert.equal(isMutationState(scenario), true);
  assert.deepEqual(applyMutationState([other, controller], scenario), scenario);
  assert.equal(isMutationState({ id: 2, rooms: [] }), false);
  assert.equal(isMutationState([]), false);
  assert.equal(isMutationState([updated, null]), false);
  assert.equal(isMutationState([{ ...updated, faults: undefined }]), false);
  assert.equal(isMutationState([{ ...updated, rooms: [null] }]), false);
  assert.equal(isMutationState([{ ...updated, rooms: [{ ...controller.rooms[0], lightStrips: [null] }] }]), false);
  assert.equal(isMutationState([updated, updated]), false);
});

test('older mutation responses cannot replace a newer controller revision', () => {
  const current = { ...controller, revision: 8, status: 'Faulted' };
  const stale = { ...controller, revision: 7, status: 'Healthy' };
  assert.equal(applyMutationState([current], stale), null);
  assert.deepEqual(applyMutationState([current], [stale]), [current]);
  assert.equal(applyMutationState([current], [{ ...stale, id: 'different-controller' }]), null);
});

test('transport-status failures are isolated from the building snapshot', async () => {
  assert.deepEqual(await readTransportStatus({
    ok: true, json: async () => ({ mqttConnected: true })
  }), { mqttConnected: true });
  assert.equal(await readTransportStatus({ ok: false }), null);
  assert.equal(await readTransportStatus({ ok: true, json: async () => { throw new Error('invalid JSON'); } }), null);
  assert.equal(await readTransportStatus(null), null);
});

test('building-view and design-status API payloads are validated before use', () => {
  const design = {
    revision: 1, width: 20, depth: 20,
    floors: [{
      id: 'floor-2', number: 2, controllerId: 'controller-floor-2',
      controllerX: 5.5, controllerZ: 6.5,
      rooms: [{
        id: 'floor-2-main', name: 'Boardroom', x: 1, z: 1, width: 5, depth: 5,
        sensor: { id: 'sensor-boardroom', x: 2, z: 2, controllerId: 'controller-floor-2' },
        doors: [{ id: 'door-boardroom', x: 3, z: 1 }],
        lights: [{ id: 'light-1', x: 2, z: 2, controllerId: 'controller-floor-2' }]
      }]
    }]
  };
  assert.equal(isBuildingView({ design, controllers }), true);
  assert.equal(isBuildingView({ design: { ...design, floors: [{ ...design.floors[0], rooms: [null] }] }, controllers }), false);
  assert.equal(isBuildingView({ design, controllers: [{ ...controller, status: 'Unknown' }] }), false);
  assert.equal(isDesignStatus({
    savedRevision: 3, runningRevision: 2, pendingCleanup: 1, failedCleanup: 0,
    completedCleanup: 4, activationStatus: 'pending'
  }), true);
  assert.equal(isDesignStatus({
    savedRevision: '3', runningRevision: 2, pendingCleanup: 1, failedCleanup: 0,
    completedCleanup: 4, activationStatus: 'pending'
  }), false);
});

test('refresh ordering drops old requests and suppresses requests superseded by mutations', () => {
  assert.equal(refreshDisposition(4, 5, 3), 'outdated');
  assert.equal(refreshDisposition(4, 3, 5), 'superseded');
  assert.equal(refreshDisposition(5, 4, 5), 'apply');
});

test('failed refreshes are ignored when newer work or a mutation supersedes them', () => {
  assert.equal(refreshFailureDisposition(4, 5, 3, 3), 'outdated');
  assert.equal(refreshFailureDisposition(5, 5, 3, 6), 'superseded');
  assert.equal(refreshFailureDisposition(5, 5, 4, 5), 'apply');
});

test('pointer clicks select wall rooms while drags and non-primary clicks do not', () => {
  const selection = {
    type: 'room', roomId: 'floor-2-main', controllerId: 'controller-floor-2', floor: 2
  };
  const wall = { userData: { selection } };
  assert.deepEqual(selectionForPointerUp(0, 0, wall), selection);
  assert.equal(selectionForPointerUp(0, 8, wall), undefined);
  assert.equal(selectionForPointerUp(2, 0, wall), undefined);
  assert.equal(selectionForPointerUp(0, 0, null), null);
  assert.equal(selectionForPointerUp(0, 0, { userData: { selection: { type: 'room' } } }), null);
});
