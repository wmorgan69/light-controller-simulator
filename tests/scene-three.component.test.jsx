import { expect, it } from 'vitest';
import * as THREE from 'three';
import { createDesignDoors, createDesignWalkways, createFloorWalkway, createOpenDoor } from '../src/Devices.Simulator.Web/frontend/scene/building-access.ts';
import { createDesignFloorPillars, createFloorPillars } from '../src/Devices.Simulator.Web/frontend/scene/building-pillars.ts';
import { createDesignFloorSlab, createFloorSlab, createFloorStairLandings, createFloorStairs, createIncomingFloorStairs } from '../src/Devices.Simulator.Web/frontend/scene/building-stairs.ts';
import { disposeGroup } from '../src/Devices.Simulator.Web/frontend/scene/SceneCanvas';
import { createDesignStair } from '../src/Devices.Simulator.Web/frontend/scene/building-placeable-access.ts';

it('preserves sectional stair transparency through floor emphasis without marking full flights', () => {
  const stair = { id: 'stair-1', x: 2, z: 3, width: 2.4, depth: 0.8, direction: 'east' };
  for (const section of ['outgoing', 'incoming', 'full']) {
    const group = createDesignStair(stair, 12, 10, 0, section);
    for (const tread of group.children) {
      const sectional = section !== 'full';
      expect(tread.material.userData.preserveTransparency === true).toBe(sectional);
      expect(tread.material.transparent).toBe(sectional);
      expect(tread.material.opacity).toBe(sectional ? 0.65 : 1);
      expect(tread.material.depthWrite).toBe(!sectional);
    }
    disposeGroup(group);
  }
});

it('creates renderable and disposable scene geometry with the renderer Three.js runtime', () => {
  const area = { x: 0, z: 0, width: 4, depth: 4, door: { side: 'front', center: 0 },
    doors: [{ side: 'front', center: 0 }] };
  const building = new THREE.Group();
  building.add(
    ...createFloorSlab(0, true, 1),
    createDesignFloorSlab(0, 10, 8),
    ...createFloorStairLandings(0, 2),
    createFloorStairs(0, false, false, 2),
    createIncomingFloorStairs(0, 2),
    createFloorPillars(0, false),
    createDesignFloorPillars(0, false, 10, 8, 1.2),
    createFloorWalkway(0),
    ...createDesignWalkways(0, 10, 8),
    createOpenDoor(area, 0),
    ...createDesignDoors(area, 0)
  );
  building.updateMatrixWorld(true);
  const frustum = new THREE.Frustum();
  const meshes = [];
  building.traverse(object => {
    expect(object).toBeInstanceOf(THREE.Object3D);
    if (object instanceof THREE.Mesh) {
      meshes.push(object);
      expect(() => frustum.intersectsObject(object)).not.toThrow();
    }
  });
  expect(meshes.length).toBeGreaterThan(20);
  const disposed = [];
  for (const mesh of meshes) {
    mesh.geometry.addEventListener('dispose', () => disposed.push(mesh.geometry));
    mesh.material.addEventListener('dispose', () => disposed.push(mesh.material));
  }
  disposeGroup(building);
  expect(disposed).toHaveLength(meshes.length * 2);
  expect(building.children).toHaveLength(0);
});

it('disposes scene labels and line resources when a building is replaced', () => {
  const building = new THREE.Group();
  const texture = new THREE.Texture();
  const material = new THREE.MeshBasicMaterial({ map: texture });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), material);
  const line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial());
  building.add(mesh, line);
  const disposed = [];
  for (const resource of [texture, material, mesh.geometry, line.geometry, line.material]) {
    resource.addEventListener('dispose', () => disposed.push(resource));
  }
  disposeGroup(building);
  expect(disposed).toHaveLength(5);
  expect(new Set(disposed).size).toBe(5);
  expect(building.children).toHaveLength(0);
});
