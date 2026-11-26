import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import * as THREE from 'three';

const mocks = vi.hoisted(() => ({ renderers: [], controls: [], observers: [], frames: [], failInit: false }));
vi.mock('three', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...actual,
    WebGLRenderer: class {
      constructor({ canvas }) {
        if (mocks.failInit) throw new Error('WebGL unavailable');
        this.domElement = canvas;
        this.setPixelRatio = vi.fn();
        this.setSize = vi.fn();
        this.render = vi.fn();
        this.dispose = vi.fn();
        mocks.renderers.push(this);
      }
    }
  };
});
vi.mock('three/addons/controls/OrbitControls.js', async () => {
  const { Vector3 } = await import('three');
  return {
    OrbitControls: class {
      constructor() {
        this.target = new Vector3();
        this.addEventListener = vi.fn();
        this.update = vi.fn();
        this.dispose = vi.fn();
        mocks.controls.push(this);
      }
    }
  };
});
import { SceneCanvas } from '../../src/Devices.BuildingControl.Web/frontend/scene/SceneCanvas';
import { materializeLegacyAccess } from '../../src/Devices.BuildingControl.Web/frontend/shared/building-editor-access';

const controller = {
  id: 'controller-floor-1', floor: 1, status: 'Healthy', faults: [], revision: 1,
  rooms: [{
    id: 'floor-1-office-a', name: 'Office', controllerId: 'controller-floor-1', sensorId: 'sensor-1',
    sensorTriggered: true, presence: true, lightStrips: [
      { id: 'light-1', roomId: 'floor-1-office-a', isOn: true, isFaulted: false }
    ]
  }]
};
const props = () => ({
  controllers: [controller], design: null, floor: 1, selectedRoomId: 'floor-1-office-a', wiring: true,
  onSelect: vi.fn(), onError: vi.fn(), onReady: vi.fn(), onRendererError: vi.fn(),
  onRendererReady: vi.fn(), cameraResetVersion: 0
});

beforeEach(() => {
  mocks.renderers = []; mocks.controls = []; mocks.observers = []; mocks.frames = []; mocks.failInit = false;
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback) { this.callback = callback; this.observe = vi.fn(); this.disconnect = vi.fn(); mocks.observers.push(this); }
  });
  vi.stubGlobal('requestAnimationFrame', vi.fn(callback => { mocks.frames.push(callback); return mocks.frames.length; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillRect() {}, fillText() {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 800, height: 600, left: 0, top: 0, right: 800, bottom: 600, x: 0, y: 0
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('widens light rays downward from the fixture rather than converging toward the floor', () => {
  render(<SceneCanvas {...props()} />);
  const scene = mocks.renderers[0].render.mock.calls[0][0];
  scene.updateMatrixWorld(true);
  const lights = [];
  scene.traverse(object => {
    if (object.userData.selection?.type === 'light') lights.push(object);
  });
  expect(lights).toHaveLength(1);
  const light = lights[0];
  const rays = light.children.find(child => child.geometry instanceof THREE.ConeGeometry);
  expect(rays).toBeDefined();
  const origin = light.getWorldPosition(new THREE.Vector3());
  const positions = rays.geometry.getAttribute('position');
  const vertices = Array.from({ length: positions.count }, (_, index) =>
    new THREE.Vector3().fromBufferAttribute(positions, index).applyMatrix4(rays.matrixWorld));
  const top = Math.max(...vertices.map(vertex => vertex.y));
  const bottom = Math.min(...vertices.map(vertex => vertex.y));
  expect(top).toBeCloseTo(origin.y - 0.01);
  expect(bottom).toBeCloseTo(origin.y - 1.09);
  for (const vertex of vertices) {
    const radius = Math.hypot(vertex.x - origin.x, vertex.z - origin.z);
    if (Math.abs(vertex.y - top) < 1e-6) expect(radius).toBeLessThan(1e-6);
    if (Math.abs(vertex.y - bottom) < 1e-6) expect(radius).toBeCloseTo(0.7);
  }
});

it.each([[10, 8], [20, 20]])('renders revision-one design geometry at %s by %s without mutating it', (width, depth) => {
  const callbacks = props();
  const design = { revision: 1, width, depth, floors: [{
    id: 'floor-1', number: 1, controllerId: controller.id, controllerX: 1, controllerZ: 1,
    rooms: [{
      id: controller.rooms[0].id, name: 'Office', x: 1, z: 1, width: 3, depth: 2,
      sensor: { id: 'sensor-1', x: 2, z: 2, controllerId: controller.id },
      doors: [], lights: []
    }], walkways: null, stairs: null
  }] };
  const original = structuredClone(design);
  render(<SceneCanvas {...callbacks} design={design} />);
  const scene = mocks.renderers[0].render.mock.calls[0][0];
  const sensors = [];
  const slabs = [];
  scene.traverse(object => {
    if (object.userData.selection?.type === 'sensor') sensors.push(object);
    if (object.isMesh && object.userData.selection?.type === 'floor' &&
        object.geometry.parameters?.height === 0.18) slabs.push(object);
  });
  expect(callbacks.onError).not.toHaveBeenCalled();
  expect(sensors[0].position.x).toBe(2 - width / 2);
  expect(sensors[0].position.z).toBe(2 - depth / 2);
  expect(slabs.some(slab => slab.geometry.parameters.width === width &&
    slab.geometry.parameters.depth === depth)).toBe(true);
  expect(design).toEqual(original);
});

it('keeps decorative pillars in place when legacy access is saved', () => {
  const design = { revision: 1, width: 10, depth: 8, floors: [{
    id: 'floor-1', number: 1, controllerId: controller.id, controllerX: 0.5, controllerZ: 0.5,
    rooms: [], walkways: null, stairs: null
  }] };
  const callbacks = { ...props(), controllers: [{ ...controller, rooms: [] }], floor: null, design };
  const { rerender } = render(<SceneCanvas {...callbacks} />);
  const scene = mocks.renderers[0].render.mock.calls[0][0];
  const pillarPositions = () => {
    const positions = [];
    scene.traverse(object => {
      if (object.isMesh && object.geometry.parameters?.width === 0.12 &&
          object.geometry.parameters?.depth === 0.12) positions.push(object.position.toArray());
    });
    return positions;
  };
  const before = pillarPositions();
  expect(before).toHaveLength(4);
  const saved = structuredClone(design);
  let id = 0;
  materializeLegacyAccess(saved, prefix => `${prefix}-${++id}`);
  saved.revision = 2;
  rerender(<SceneCanvas {...callbacks} design={saved} />);
  expect(pillarPositions()).toEqual(before);
});

it('builds a scene, renders it, and disposes resources on unmount', () => {
  const callbacks = props();
  const { unmount } = render(<SceneCanvas {...callbacks} />);
  expect(callbacks.onError).not.toHaveBeenCalled();
  expect(callbacks.onReady).toHaveBeenCalledOnce();
  expect(mocks.renderers[0].setSize).toHaveBeenCalledWith(800, 600, false);
  act(() => mocks.frames.shift()());
  expect(callbacks.onRendererReady).toHaveBeenCalledOnce();
  const scene = mocks.renderers[0].render.mock.calls.at(-1)[0];
  const geometries = [];
  scene.traverse(object => { if (object.geometry) geometries.push(object.geometry); });
  expect(geometries.length).toBeGreaterThan(0);
  const disposed = vi.fn();
  geometries[0].addEventListener('dispose', disposed);
  unmount();
  expect(disposed).toHaveBeenCalledOnce();
  expect(mocks.renderers[0].dispose).toHaveBeenCalledOnce();
  expect(mocks.controls[0].dispose).toHaveBeenCalledOnce();
  expect(mocks.observers[0].disconnect).toHaveBeenCalledOnce();
});

it('marks only a faulted sensor route as dashed and restores it when the fault clears', () => {
  const callbacks = props();
  const otherRoom = { ...controller.rooms[0], id: 'floor-1-office-b', sensorId: 'sensor-2', lightStrips: [] };
  const faulted = {
    ...controller, rooms: [...controller.rooms, otherRoom],
    faults: [{ scope: 'sensor', targetId: 'sensor-1' }]
  };
  const { rerender } = render(<SceneCanvas {...callbacks} controllers={[faulted]} />);
  const scene = mocks.renderers[0].render.mock.calls[0][0];
  const routes = () => {
    const lines = [];
    scene.traverse(object => {
      if (object instanceof THREE.Line && !(object instanceof THREE.LineSegments)) lines.push(object);
    });
    return lines;
  };
  const dashed = routes().filter(line => line.material instanceof THREE.LineDashedMaterial);
  expect(dashed).toHaveLength(1);
  expect(dashed[0].material.color.getHexString()).toBe('ef4444');
  expect(dashed[0].geometry.getAttribute('lineDistance')).toBeTruthy();
  const healthy = routes().filter(line => line.material.color.getHexString() === '38bdf8');
  expect(healthy).toHaveLength(1);
  const faultPoints = dashed[0].geometry.getAttribute('position');
  const healthyPoints = healthy[0].geometry.getAttribute('position');
  expect(faultPoints.getX(2)).not.toBe(healthyPoints.getX(2));
  expect(faultPoints.getZ(2)).not.toBe(healthyPoints.getZ(2));
  expect(faultPoints.getY(3)).not.toBe(healthyPoints.getY(3));
  for (const points of [faultPoints, healthyPoints]) {
    for (let index = 1; index < points.count; index++) {
      const differences = [points.getX, points.getY, points.getZ]
        .filter(get => get.call(points, index) !== get.call(points, index - 1));
      expect(differences).toHaveLength(1);
    }
  }
  expect(routes().filter(line => line.material.color.getHexString() === 'fbbf24')).toHaveLength(1);
  rerender(<SceneCanvas {...callbacks} controllers={[{ ...faulted, faults: [] }]} />);
  expect(routes().filter(line => line.material instanceof THREE.LineDashedMaterial)).toHaveLength(0);
  expect(routes().filter(line => line.material.color.getHexString() === '38bdf8')).toHaveLength(2);
  rerender(<SceneCanvas {...callbacks} controllers={[{ ...faulted, faults: [{ scope: 'light', targetId: 'light-1' }] }]} />);
  expect(routes().filter(line => line.material instanceof THREE.LineDashedMaterial)).toHaveLength(0);
});

it('uses outlines for room selection without changing the sensor or wall state colors', () => {
  const callbacks = props();
  const { rerender } = render(<SceneCanvas {...callbacks} />);
  const scene = mocks.renderers[0].render.mock.calls[0][0];
  const selectedWalls = [];
  scene.traverse(object => {
    if (object instanceof THREE.Mesh && object.userData.selection?.type === 'room' &&
        object.children.some(child => child instanceof THREE.LineSegments)) selectedWalls.push(object);
  });
  expect(selectedWalls.length).toBeGreaterThan(0);
  const selectedColor = selectedWalls[0].material.color.getHexString();
  const sensors = [];
  scene.traverse(object => { if (object.userData.selection?.type === 'sensor') sensors.push(object); });
  const sensorColor = sensors[0].material.color.getHexString();
  rerender(<SceneCanvas {...callbacks} controllers={[{
    ...controller, faults: [{ scope: 'sensor', targetId: 'sensor-1' }]
  }]} />);
  const faultedSensor = [];
  scene.traverse(object => { if (object.userData.selection?.type === 'sensor') faultedSensor.push(object); });
  expect(faultedSensor[0].material.color.getHexString()).toBe('ef4444');
  const faultedOutlinedWalls = [];
  scene.traverse(object => {
    if (object instanceof THREE.Mesh && object.userData.selection?.type === 'room' &&
        object.children.some(child => child instanceof THREE.LineSegments)) faultedOutlinedWalls.push(object);
  });
  expect(faultedOutlinedWalls.length).toBeGreaterThan(0);
  expect(faultedOutlinedWalls[0].material.color.getHexString()).toBe(selectedColor);
  rerender(<SceneCanvas {...callbacks} selectedRoomId={null} />);
  const walls = [];
  scene.traverse(object => {
    if (object instanceof THREE.Mesh && object.userData.selection?.type === 'room' &&
        object.geometry instanceof THREE.BoxGeometry && object.geometry.parameters.height > 0.1) walls.push(object);
  });
  expect(walls[0].material.color.getHexString()).toBe(selectedColor);
  expect(walls.every(wall => !wall.children.some(child => child instanceof THREE.LineSegments))).toBe(true);
  const unselectedSensor = [];
  scene.traverse(object => { if (object.userData.selection?.type === 'sensor') unselectedSensor.push(object); });
  expect(unselectedSensor[0].material.color.getHexString()).toBe(sensorColor);
});

it('separates coincident sensors in adjacent edited rooms without changing their design positions', () => {
  const callbacks = props();
  const rooms = [
    { ...controller.rooms[0], id: 'room-a', sensorId: 'sensor-a', lightStrips: [] },
    { ...controller.rooms[0], id: 'room-b', sensorId: 'sensor-b', lightStrips: [] }
  ];
  const designRooms = rooms.map((room, index) => ({
    id: room.id, name: room.name, x: index * 5, z: 0, width: 5, depth: 5,
    sensor: { id: room.sensorId, x: 5, z: 2.5, controllerId: controller.id },
    doors: [], lights: []
  }));
  const design = { revision: 2, width: 10, depth: 10, floors: [{
    id: 'floor-1', number: 1, controllerId: controller.id, controllerX: 0, controllerZ: 0, rooms: designRooms
  }] };
  render(<SceneCanvas {...callbacks} controllers={[{
    ...controller, rooms, faults: [{ id: 'fault-a', scope: 'sensor', targetId: 'sensor-a' }]
  }]} design={design} selectedRoomId="room-a" />);
  const scene = mocks.renderers[0].render.mock.calls[0][0];
  const sensors = [];
  scene.traverse(object => { if (object.userData.selection?.type === 'sensor') sensors.push(object); });
  expect(sensors).toHaveLength(2);
  expect(sensors[0].position.distanceTo(sensors[1].position)).toBeGreaterThan(0.3);
  expect(designRooms.map(room => room.sensor.x)).toEqual([5, 5]);
  const routes = [];
  scene.traverse(object => {
    if (object instanceof THREE.Line && !(object instanceof THREE.LineSegments)) routes.push(object);
  });
  for (const sensor of sensors) {
    expect(routes.some(line => {
      const positions = line.geometry.getAttribute('position');
      const end = positions.count - 1;
      return Math.abs(positions.getX(end) - sensor.position.x) < 0.00001 &&
        Math.abs(positions.getZ(end) - sensor.position.z) < 0.00001;
    })).toBe(true);
  }
});

it('keeps a separated sensor visible when it would overlap a light', () => {
  const callbacks = props();
  const rooms = [
    { ...controller.rooms[0], id: 'room-a', sensorId: 'sensor-a' },
    { ...controller.rooms[0], id: 'room-b', sensorId: 'sensor-b', lightStrips: [] }
  ];
  const designRooms = rooms.map((room, index) => ({
    id: room.id, name: room.name, x: index * 5, z: 0, width: 5, depth: 5,
    sensor: { id: room.sensorId, x: 5, z: 2.5, controllerId: controller.id },
    doors: [], lights: index === 0 ? [{ id: 'light-1', x: 4.5, z: 2.5, controllerId: controller.id }] : []
  }));
  const design = { revision: 2, width: 10, depth: 10, floors: [{
    id: 'floor-1', number: 1, controllerId: controller.id, controllerX: 0, controllerZ: 0, rooms: designRooms
  }] };
  render(<SceneCanvas {...callbacks} controllers={[{
    ...controller, rooms, faults: [{ id: 'fault-a', scope: 'sensor', targetId: 'sensor-a' }]
  }]} design={design} selectedRoomId="room-a" />);
  const scene = mocks.renderers[0].render.mock.calls[0][0];
  const objects = [];
  scene.traverse(object => { if (object.userData.selection?.roomId === 'room-a') objects.push(object); });
  const sensor = objects.find(object => object.userData.selection.type === 'sensor');
  const light = objects.find(object => object.userData.selection.type === 'light');
  act(() => { for (let frame = 0; frame < 74; frame++) mocks.frames.shift()(); });
  expect(sensor.scale.y).toBeGreaterThan(1.15);
  expect(sensor.position.y - 0.15 * sensor.scale.y).toBeGreaterThan(light.position.y + 0.045);
  const routes = [];
  scene.traverse(object => {
    if (object instanceof THREE.Line && !(object instanceof THREE.LineSegments)) routes.push(object);
  });
  const sensorRoute = routes.find(line => line.material.color.getHexString() === 'ef4444' &&
    Math.abs(line.geometry.getAttribute('position').getX(line.geometry.getAttribute('position').count - 1) - sensor.position.x) < 0.00001);
  const points = sensorRoute.geometry.getAttribute('position');
  expect(points.getY(points.count - 1)).toBeCloseTo(sensor.position.y + 0.15);
});

it('renders placeable access across adjacent floors and switches incoming and outgoing flights', () => {
  const callbacks = props();
  const lowerController = { ...controller, rooms: [] };
  const upperController = { ...controller, id: 'controller-floor-2', floor: 2, rooms: [] };
  const lowerFloor = {
    id: 'floor-1', number: 1, controllerId: lowerController.id, controllerX: 0, controllerZ: 0, rooms: [],
    walkways: [{ id: 'walkway-1', x: 1, z: 2, width: 3, depth: 1 }],
    stairs: [{ id: 'stair-1', x: 2, z: 3, width: 2, depth: 4, direction: 'east' }]
  };
  const upperFloor = {
    id: 'floor-2', number: 2, controllerId: upperController.id, controllerX: 0, controllerZ: 0, rooms: [],
    walkways: [], stairs: []
  };
  const design = { revision: 2, width: 12, depth: 10, floors: [upperFloor, lowerFloor] };
  const controllers = [lowerController, upperController];
  const { rerender } = render(<SceneCanvas {...callbacks} controllers={controllers} design={design} floor={null} />);
  const scene = mocks.renderers[0].render.mock.calls[0][0];
  const accessObjects = () => {
    const objects = [];
    scene.traverse(object => { if (object.userData.walkwayId || object.userData.stairId) objects.push(object); });
    return objects;
  };
  const stairTreads = () => accessObjects().filter(object => object.isMesh && object.userData.stairId === 'stair-1');
  const walkways = () => accessObjects().filter(object => object.userData.walkwayId === 'walkway-1');

  expect(callbacks.onError).not.toHaveBeenCalled();
  expect(walkways()).toHaveLength(1);
  expect(walkways()[0].position.toArray()).toEqual([-3.5, 0, -2.5]);
  expect(stairTreads()).toHaveLength(18);
  expect(new THREE.Box3().setFromObject(stairTreads()[0].parent).max.y).toBeCloseTo(2.45);

  scene.updateMatrixWorld(true);
  const upperSlabs = [];
  scene.traverse(object => {
    if (object.isMesh && object.userData.selection?.type === 'floor' &&
        object.userData.selection.floor === 2 && object.geometry.parameters?.height === 0.18) {
      upperSlabs.push(new THREE.Box3().setFromObject(object));
    }
  });
  const contains = (box, x, z) => box.min.x < x && box.max.x > x && box.min.z < z && box.max.z > z;
  expect(upperSlabs.some(box => contains(box, -3, 0))).toBe(false);
  expect(upperSlabs.some(box => contains(box, 0, 0))).toBe(true);

  rerender(<SceneCanvas {...callbacks} controllers={controllers} design={design} floor={1} />);
  expect(stairTreads()).toHaveLength(10);
  expect(stairTreads()[0].userData.treadIndex).toBe(0);

  rerender(<SceneCanvas {...callbacks} controllers={controllers} design={design} floor={2} />);
  expect(stairTreads()).toHaveLength(10);
  expect(stairTreads()[0].userData.treadIndex).toBe(8);
  expect(Math.max(...stairTreads().map(tread => new THREE.Box3().setFromObject(tread).max.y))).toBeCloseTo(2.45);
});

it('preserves generated access for null arrays and replaces it with explicit empty arrays', () => {
  const callbacks = props();
  const lowerController = { ...controller, rooms: [] };
  const upperController = { ...controller, id: 'controller-floor-2', floor: 2, rooms: [] };
  const makeFloor = (number, itemController, access = {}) => ({
    id: `floor-${number}`, number, controllerId: itemController.id, controllerX: 0, controllerZ: 0,
    rooms: [], ...access
  });
  const controllers = [lowerController, upperController];
  const legacyDesign = {
    revision: 2, width: 12, depth: 10,
    floors: [
      makeFloor(1, lowerController, { walkways: null, stairs: null }),
      makeFloor(2, upperController)
    ]
  };
  const { rerender } = render(<SceneCanvas {...callbacks} controllers={controllers} design={legacyDesign} floor={null} />);
  const scene = mocks.renderers[0].render.mock.calls[0][0];
  const automaticWalkwaysAt = y => {
    const found = [];
    scene.traverse(object => {
      if (object.isMesh && object.geometry.parameters?.height === 0.06 &&
          Math.abs(object.position.y - y) < 1e-8) found.push(object);
    });
    return found;
  };
  const legacyStairTreads = () => {
    const found = [];
    scene.traverse(object => {
      if (object.isMesh && object.geometry.parameters?.depth === 0.8 &&
          Math.abs(object.geometry.parameters.width - 2.4 / 18) < 1e-8) found.push(object);
    });
    return found;
  };
  expect(automaticWalkwaysAt(0)).toHaveLength(5);
  expect(automaticWalkwaysAt(2.45)).toHaveLength(5);
  expect(legacyStairTreads()).toHaveLength(18);

  const replacedDesign = {
    ...legacyDesign,
    floors: [
      makeFloor(1, lowerController, { walkways: [], stairs: [] }),
      makeFloor(2, upperController, { walkways: [], stairs: [] })
    ]
  };
  rerender(<SceneCanvas {...callbacks} controllers={controllers} design={replacedDesign} floor={null} />);
  expect(automaticWalkwaysAt(0)).toHaveLength(0);
  expect(automaticWalkwaysAt(2.45)).toHaveLength(0);
  expect(legacyStairTreads()).toHaveLength(0);
  expect(accessObjectsFor(scene, 'stairId')).toHaveLength(0);
});

it('uses materialized access arrays on baseline designs without duplicating baseline geometry', () => {
  const callbacks = props();
  const lowerController = { ...controller, rooms: [] };
  const upperController = { ...controller, id: 'controller-floor-2', floor: 2, rooms: [] };
  const makeFloor = (number, itemController, walkways, stairs) => ({
    id: `floor-${number}`, number, controllerId: itemController.id, controllerX: 0, controllerZ: 0,
    rooms: [], walkways, stairs
  });
  const design = {
    revision: 1, width: 20, depth: 20,
    floors: [
      makeFloor(2, upperController, [
        { id: 'upper-hall', x: 9.9, z: 8, width: 4.4, depth: 0.6 },
        { id: 'upper-landing', x: 13.42, z: 6.19, width: 0.8, depth: 1.81 }
      ], []),
      makeFloor(1, lowerController, [
        { id: 'lower-hall', x: 9.9, z: 8, width: 4.4, depth: 0.6 },
        { id: 'lower-landing', x: 10.18, z: 6.19, width: 0.8, depth: 1.81 }
      ], [{ id: 'stair-baseline', x: 11, z: 6.24, width: 2.4, depth: 0.8, direction: 'east' }])
    ]
  };
  render(<SceneCanvas {...callbacks} controllers={[lowerController, upperController]} design={design} floor={null} />);
  const scene = mocks.renderers[0].render.mock.calls[0][0];
  const objectsWith = key => accessObjectsFor(scene, key);
  expect(callbacks.onError).not.toHaveBeenCalled();
  expect(objectsWith('walkwayId').map(object => object.userData.walkwayId).sort()).toEqual([
    'lower-hall', 'lower-landing', 'upper-hall', 'upper-landing'
  ]);
  expect(objectsWith('stairId').filter(object => object.isMesh)).toHaveLength(18);

  const accessSlabs = [];
  scene.traverse(object => {
    if (object.isMesh && object.userData.selection?.type === 'floor' &&
        object.userData.selection.floor === 2 && object.geometry.parameters?.height === 0.18) {
      accessSlabs.push(new THREE.Box3().setFromObject(object));
    }
  });
  const contains = (box, x, z) => box.min.x < x && box.max.x > x && box.min.z < z && box.max.z > z;
  expect(accessSlabs.some(box => contains(box, 2, -3.3))).toBe(false);
  expect(accessSlabs.some(box => contains(box, 0, 0))).toBe(true);

  const baselineTreads = [];
  scene.traverse(object => {
    if (object.isMesh && !object.userData.stairId && object.geometry.parameters?.depth === 0.8 &&
        Math.abs(object.geometry.parameters.width - 2.4 / 18) < 1e-8) baselineTreads.push(object);
  });
  expect(baselineTreads).toHaveLength(0);
});

it('resolves walkway and stair nullability independently on mixed floors', () => {
  const callbacks = props();
  const controllers = [1, 2, 3].map(floor => ({
    ...controller, id: `controller-floor-${floor}`, floor, rooms: []
  }));
  const floors = controllers.map((item, index) => ({
    id: `floor-${item.floor}`, number: item.floor, controllerId: item.id,
    controllerX: 0, controllerZ: 0, rooms: [],
    walkways: index === 1 ? null : [],
    stairs: index === 0 ? null : []
  }));
  const design = { revision: 2, width: 12, depth: 10, floors };
  render(<SceneCanvas {...callbacks} controllers={controllers} design={design} floor={null} />);
  const scene = mocks.renderers[0].render.mock.calls[0][0];
  const walkwayMeshesAt = y => {
    const found = [];
    scene.traverse(object => {
      if (object.isMesh && object.geometry.parameters?.height === 0.06 &&
          Math.abs(object.position.y - y) < 1e-8) found.push(object);
    });
    return found;
  };
  expect(walkwayMeshesAt(0)).toHaveLength(0);
  expect(walkwayMeshesAt(2.45)).toHaveLength(5);
  expect(walkwayMeshesAt(4.9)).toHaveLength(0);
  const legacyStairTreads = [];
  scene.traverse(object => {
    if (object.isMesh && object.userData.stairId && object.geometry.parameters?.depth === 0.8 &&
        Math.abs(object.geometry.parameters.width - 2.4 / 18) < 1e-8) legacyStairTreads.push(object);
  });
  expect(legacyStairTreads).toHaveLength(18);
  expect(accessObjectsFor(scene, 'stairId').filter(object => object.isMesh)).toHaveLength(18);
});

it('omits a placeable staircase when the adjacent floor has been removed', () => {
  const callbacks = props();
  const lowerController = { ...controller, rooms: [] };
  const upperController = { ...controller, id: 'controller-floor-2', floor: 2, rooms: [] };
  const design = {
    revision: 2, width: 12, depth: 10,
    floors: [{
      id: 'floor-1', number: 1, controllerId: lowerController.id, controllerX: 0, controllerZ: 0, rooms: [],
      walkways: [], stairs: [{ id: 'stair-1', x: 2, z: 3, width: 2, depth: 4, direction: 'east' }]
    }, {
      id: 'floor-2', number: 2, controllerId: upperController.id, controllerX: 0, controllerZ: 0, rooms: [],
      walkways: [], stairs: []
    }]
  };
  const { rerender } = render(<SceneCanvas {...callbacks} controllers={[lowerController, upperController]} design={design} floor={null} />);
  const scene = mocks.renderers[0].render.mock.calls[0][0];
  const stairTread = accessObjectsFor(scene, 'stairId').find(object => object.isMesh);
  const disposed = vi.fn();
  stairTread.geometry.addEventListener('dispose', disposed);
  const removedFloorDesign = { ...design, floors: [design.floors[0]] };
  rerender(<SceneCanvas {...callbacks} controllers={[lowerController]} design={removedFloorDesign} />);
  expect(disposed).toHaveBeenCalledOnce();
  expect(accessObjectsFor(scene, 'stairId')).toHaveLength(0);
});

it('preserves edited-design pillars when walkways are materialized or cleared', () => {
  const callbacks = props();
  const controllers = [1, 2].map(floor => ({
    ...controller, id: `controller-floor-${floor}`, floor, rooms: []
  }));
  const design = {
    revision: 2, width: 12, depth: 10,
    floors: controllers.map(item => ({
      id: `floor-${item.floor}`, number: item.floor, controllerId: item.id,
      controllerX: 0, controllerZ: 0, rooms: [], walkways: null, stairs: []
    }))
  };
  const { rerender } = render(<SceneCanvas {...callbacks} controllers={controllers} design={design} floor={null} />);
  const scene = mocks.renderers[0].render.mock.calls[0][0];
  const pillarPositions = () => {
    const positions = [];
    scene.traverse(object => {
      if (object.isMesh && object.geometry.parameters?.width === 0.12 &&
          object.geometry.parameters?.depth === 0.12) positions.push(object.position.toArray());
    });
    return positions;
  };
  const original = pillarPositions();
  expect(original).toHaveLength(8);
  const materialized = {
    ...design,
    floors: design.floors.map(item => ({
      ...item, walkways: [{ id: `walkway-${item.number}`, x: 0, z: 0, width: 2, depth: 1 }]
    }))
  };
  rerender(<SceneCanvas {...callbacks} controllers={controllers} design={materialized} floor={null} />);
  expect(pillarPositions()).toEqual(original);
  const cleared = { ...design, floors: design.floors.map(item => ({ ...item, walkways: [] })) };
  rerender(<SceneCanvas {...callbacks} controllers={controllers} design={cleared} floor={null} />);
  expect(pillarPositions()).toEqual(original);
});

function accessObjectsFor(scene, key) {
  const objects = [];
  scene.traverse(object => { if (object.userData[key]) objects.push(object); });
  return objects;
}

it('reports a mismatched design and recovers when the scene receives a valid snapshot', () => {
  const callbacks = props();
  const invalidDesign = { revision: 2, width: 20, depth: 20, floors: [] };
  const { rerender } = render(<SceneCanvas {...callbacks} design={invalidDesign} />);
  expect(callbacks.onError).toHaveBeenCalledOnce();
  expect(callbacks.onReady).not.toHaveBeenCalled();
  rerender(<SceneCanvas {...callbacks} design={null} />);
  expect(callbacks.onReady).toHaveBeenCalledOnce();
  act(() => mocks.frames.shift()());
  expect(callbacks.onRendererReady).toHaveBeenCalledOnce();
});

it('reports renderer initialization and context loss without continuing animation', () => {
  mocks.failInit = true;
  const failed = props();
  const { unmount } = render(<SceneCanvas {...failed} />);
  expect(failed.onRendererError.mock.calls[0][0].message).toBe('WebGL unavailable');
  expect(failed.onReady).not.toHaveBeenCalled();
  unmount();

  mocks.failInit = false;
  const callbacks = props();
  render(<SceneCanvas {...callbacks} />);
  const event = new Event('webglcontextlost', { cancelable: true });
  act(() => screen.getByRole('img').dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
  expect(callbacks.onRendererError).toHaveBeenCalledOnce();
  const calls = mocks.renderers[0].render.mock.calls.length;
  act(() => mocks.frames.shift()());
  expect(mocks.renderers[0].render).toHaveBeenCalledTimes(calls);
});
