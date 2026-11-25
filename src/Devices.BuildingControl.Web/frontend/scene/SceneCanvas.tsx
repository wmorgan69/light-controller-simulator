import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createDesignFloorPillars, createFloorPillars } from './building-pillars.js';
import {
  createDesignFloorSlab, createFloorSlab, createFloorStairLandings, createFloorStairs,
  createIncomingFloorStairs, positionDesignStairs
} from './building-stairs.js';
import {
  createDesignDoors, createDesignWalkways, createFloorWalkway, createOpenDoor,
  designWalkwayWidth, roomWallSegments
} from './building-access.js';
import {
  createDesignFloorSlabWithOpenings, createDesignStair, createDesignWalkway
} from './building-placeable-access.js';
import { designControllerPosition, designRoomView } from './building-design-view.js';
import { floorRoomLayout, roomFixturePositions, sensorRadius } from './room-fixtures.js';
import { lightEmits, lightVisualState, roomIllumination, selectedRoomVisualState, sensorFaultForRoom, sensorPulseAmount } from './room-state.js';
import { wiringRoute } from './wiring-routes.js';
import { fieldOfViewForAspect, overviewCameraScale, selectedFloorCamera } from './floor-view.js';
import { t } from '../shared/localization.en.js';
import { materializeLegacyAccess } from '../shared/building-editor-access.js';
import { selectionForPointerUp, selectionFromUserData } from '../shared/simulator-model';
import type { BuildingDesignDto, ControllerDto, SceneSelection } from '../shared/simulator-model';

interface RoomVisual {
  walls: THREE.Mesh[];
  surface: THREE.Mesh;
  outline: THREE.LineSegments;
  lights?: THREE.Mesh[];
  sensor?: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  faulted?: boolean;
}

interface WireTarget {
  position: { x: number; y: number; z: number };
  color: string;
  offset: number;
  port?: { x: number; z: number };
  faulted?: boolean;
}

interface SceneContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  building: THREE.Group;
  currentFloor: number | null;
  presetCamera: boolean;
  sceneReady: boolean;
  selectable: THREE.Object3D[];
  visuals: Map<string, RoomVisual>;
  designScale?: number;
}

interface SceneCanvasProps {
  controllers: ControllerDto[];
  design: BuildingDesignDto | null;
  floor: number | null;
  selectedRoomId: string | null;
  wiring: boolean;
  onSelect: (selection: SceneSelection | null | undefined) => void;
  onError: (error: Error) => void;
  onReady: () => void;
  onRendererError: (error: Error) => void;
  onRendererReady: () => void;
  cameraResetVersion: number;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function disposeGroup(group: THREE.Group): void {
  group.traverse(object => {
    if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.Line)) return;
    object.geometry?.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach(material => {
      if (material instanceof THREE.MeshBasicMaterial ||
          material instanceof THREE.MeshStandardMaterial ||
          material instanceof THREE.MeshPhongMaterial) {
        material.map?.dispose();
      }
      material.dispose();
    });
  });
  group.clear();
}

function labelTexture(text: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('A 2D canvas context is unavailable for the scene label.');
  context.fillStyle = '#0f172a';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#e2e8f0';
  context.font = 'bold 42px system-ui, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, canvas.width / 2, canvas.height / 2, canvas.width - 32);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeRoomWall(
  x1: number,
  z1: number,
  x2: number,
  z2: number,
  y: number,
  height: number,
  roomId: string,
  selection: SceneSelection,
  parent: THREE.Group,
  visuals: Map<string, RoomVisual>,
  selectable: THREE.Object3D[],
  selected: boolean,
  illumination: number
): void {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const wall = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(dx, dz), height, 0.12),
    new THREE.MeshStandardMaterial({
      color: '#94a3b8',
      roughness: 0.75,
      emissive: '#000000',
      emissiveIntensity: illumination * 0.35
    }));
  wall.material.emissive.lerp(new THREE.Color('#d49a46'), illumination * 0.45);
  wall.position.set((x1 + x2) / 2, y + height / 2, (z1 + z2) / 2);
  wall.rotation.y = -Math.atan2(dz, dx);
  wall.userData.selection = selection;
  selectable.push(wall);
  parent.add(wall);
  if (selected) {
    wall.add(new THREE.LineSegments(new THREE.EdgesGeometry(wall.geometry),
      new THREE.LineBasicMaterial({ color: '#f8fafc' })));
  }
  visuals.get(roomId)?.walls.push(wall);
}

function addWire(parent: THREE.Group, controller: THREE.Mesh, target: WireTarget, floorY: number): void {
  const route = wiringRoute(controller.position, target.position, floorY + 1.4, target.offset, target.port);
  const geometry = new THREE.BufferGeometry().setFromPoints(route.map(point =>
    new THREE.Vector3(point.x, point.y, point.z)));
  const material = target.faulted
    ? new THREE.LineDashedMaterial({ color: target.color, dashSize: 0.3, gapSize: 0.18 })
    : new THREE.LineBasicMaterial({ color: target.color });
  const line = new THREE.Line(geometry, material);
  if (target.faulted) line.computeLineDistances();
  parent.add(line);
}

function buildBuilding({
  controllers, design: activeDesign, floor, selectedRoomId, wiring
}: Pick<SceneCanvasProps, 'controllers' | 'design' | 'floor' | 'selectedRoomId' | 'wiring'>): {
  building: THREE.Group;
  selectable: THREE.Object3D[];
  visuals: Map<string, RoomVisual>;
} {
  const building = new THREE.Group();
  const selectable: THREE.Object3D[] = [];
  const visuals = new Map<string, RoomVisual>();
  const highestFloor = Math.max(...controllers.map(controller => controller.floor));
  const floorNumbers = new Set(controllers.map(controller => controller.floor));
  const design = activeDesign ? structuredClone(activeDesign) : null;
  if (design) {
    const accessIds = new Set(design.floors.flatMap(item =>
      [...(item.walkways ?? []), ...(item.stairs ?? [])].map(access => access.id)));
    let nextId = 0;
    materializeLegacyAccess(design, prefix => {
      let id: string;
      do { id = `scene-${prefix}-${++nextId}`; } while (accessIds.has(id));
      accessIds.add(id);
      return id;
    });
  }
  const editedDesign = design;
  const addSelectable = (object: THREE.Object3D, selection: SceneSelection, parent: THREE.Group): void => {
    object.userData.selection = selection;
    selectable.push(object);
    parent.add(object);
  };

  try {
  for (const controller of controllers) {
    if (floor !== null && floor !== controller.floor) continue;
    const y = (controller.floor - 1) * 2.45;
    const floorGroup = new THREE.Group();
    building.add(floorGroup);
    const designFloor = editedDesign?.floors.find(item => item.controllerId === controller.id);
    if (editedDesign && !designFloor) throw new Error(t('buildingDesignMismatch'));
    const floorAccess = design?.floors.find(item => item.controllerId === controller.id);
    const previousDesignFloor = design?.floors.find(item => item.number === controller.floor - 1);
    const previousAccess = previousDesignFloor;
    const designRooms = new Map(designFloor?.rooms.map(room => [room.id, room]));
    const sensorLocations = new Map<string, number>();
    for (const room of controller.rooms) {
      const sensor = designRooms.get(room.id)?.sensor;
      if (!sensor) continue;
      const key = `${sensor.x},${sensor.z}`;
      sensorLocations.set(key, (sensorLocations.get(key) ?? 0) + 1);
    }
    const wireGroup = new THREE.Group();
    wireGroup.visible = wiring && floor !== null;
    floorGroup.add(wireGroup);
    let slabs: THREE.Mesh[];
    if (editedDesign) {
      slabs = previousAccess?.stairs != null && floorNumbers.has(controller.floor - 1)
        ? createDesignFloorSlabWithOpenings(y, editedDesign.width, editedDesign.depth, previousAccess.stairs)
        : [createDesignFloorSlab(y, editedDesign.width, editedDesign.depth)];
    } else {
      slabs = createFloorSlab(y, floorNumbers.has(controller.floor - 1),
        floor !== null && controller.floor === highestFloor ? controller.floor - 1 : null);
    }
    for (const slab of slabs) {
      addSelectable(slab, { type: 'floor', controllerId: controller.id, floor: controller.floor }, floorGroup);
    }
    const walkways = design && floorAccess?.walkways != null
      ? floorAccess.walkways.map(walkway =>
        createDesignWalkway(walkway, design.width, design.depth, y))
      : editedDesign
        ? createDesignWalkways(y, editedDesign.width, editedDesign.depth)
        : [createFloorWalkway(y)];
    for (const walkway of walkways) {
      addSelectable(walkway, { type: 'floor', controllerId: controller.id, floor: controller.floor }, floorGroup);
    }
    if (floorAccess?.stairs == null) {
      for (const landing of createFloorStairLandings(y, controller.floor)) {
        if (editedDesign) positionDesignStairs(landing, editedDesign.depth, designWalkwayWidth);
        addSelectable(landing, { type: 'floor', controllerId: controller.id, floor: controller.floor }, floorGroup);
      }
    }
    const floorLabel = new THREE.Mesh(new THREE.PlaneGeometry(1.35, 0.42),
      new THREE.MeshBasicMaterial({ map: labelTexture(t('floorSceneLabel', { floor: controller.floor })), side: THREE.DoubleSide }));
    floorLabel.position.set(editedDesign ? -editedDesign.width / 2 + 0.7 : -4.45,
      y + 0.62, editedDesign ? editedDesign.depth / 2 + 0.06 : 4.06);
    addSelectable(floorLabel, { type: 'floor', controllerId: controller.id, floor: controller.floor }, floorGroup);

    const controllerBox = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.58, 0.42),
      new THREE.MeshStandardMaterial({ color: controller.status === 'Faulted' ? '#ef4444' : '#22c55e' }));
    const controllerPosition = editedDesign && designFloor
      ? designControllerPosition(editedDesign, designFloor, y)
      : { x: -4.65, y: y + 0.38, z: -3.4 };
    controllerBox.position.set(controllerPosition.x, controllerPosition.y, controllerPosition.z);
    addSelectable(controllerBox, { type: 'controller', controllerId: controller.id, roomId: controller.rooms[0]?.id, floor: controller.floor }, floorGroup);
    const wireTargets: WireTarget[] = [];

    for (const [roomIndex, room] of controller.rooms.entries()) {
      const key = room.id.slice(`floor-${controller.floor}-`.length);
      const designRoom = designRooms.get(room.id);
      if (editedDesign && !designRoom) throw new Error(t('buildingDesignMismatch'));
      const designView = editedDesign && designRoom ? designRoomView(editedDesign, designRoom, y) : null;
      const layout = floorRoomLayout(controller.floor,
        controller.rooms.map(item => item.id.slice(`floor-${controller.floor}-`.length)));
      const area = designView?.area ?? Object.entries(layout).find(([roomKey]) => roomKey === key)?.[1];
      if (!area) continue;
      const roomSelection: SceneSelection = {
        type: 'room', roomId: room.id, controllerId: controller.id, floor: controller.floor
      };
      const selected = room.id === selectedRoomId;
      const state = selectedRoomVisualState(room.presence, Boolean(sensorFaultForRoom(controller, room)));
      const surface = new THREE.Mesh(new THREE.BoxGeometry(area.width - 0.12, 0.05, area.depth - 0.12),
        new THREE.MeshStandardMaterial({
          color: selected ? state.surfaceColor : '#475569',
          emissive: '#ffbd55',
          emissiveIntensity: 0.32 * roomIllumination(room.lightStrips),
          roughness: 0.92,
          side: THREE.DoubleSide
        }));
      surface.position.set(area.x, y + 0.015, area.z);
      addSelectable(surface, roomSelection, floorGroup);
      const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(area.width - 0.06, 0.08, area.depth - 0.06)),
        new THREE.LineBasicMaterial({ color: selected ? state.outlineColor : '#64748b', transparent: !selected, opacity: selected ? 1 : 0 }));
      outline.position.set(area.x, y + 0.08, area.z);
      floorGroup.add(outline);
      visuals.set(room.id, { walls: [], surface, outline });

      for (const wall of roomWallSegments(area)) {
        makeRoomWall(wall.x1, wall.z1, wall.x2, wall.z2, y + wall.y, wall.height,
          room.id, roomSelection, floorGroup, visuals, selectable, selected, roomIllumination(room.lightStrips));
      }
      const doors: THREE.Object3D[] = designView ? createDesignDoors(area, y) : [createOpenDoor(area, y)];
      doors.forEach(door => addSelectable(door, roomSelection, floorGroup));

      const name = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(area.width * 0.72, 2.6), 0.48),
        new THREE.MeshBasicMaterial({ map: labelTexture(room.name.toUpperCase()), side: THREE.DoubleSide, depthWrite: false }));
      name.position.set(area.x, y + 0.64, area.z + area.depth / 2 + 0.07);
      floorGroup.add(name);
      const fixtures = designView?.fixtures ?? roomFixturePositions(area, y, room.lightStrips.length);
      for (const [index, strip] of room.lightStrips.entries()) {
        const point = fixtures.lights[index];
        if (!point) continue;
        const light = new THREE.Mesh(new THREE.BoxGeometry(room.lightStrips.length >= 4 ? 1.1 : 1.7, 0.09, 0.22),
          new THREE.MeshStandardMaterial(lightVisualState(strip)));
        light.position.set(point.x, point.y, point.z);
        const rays = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.08, 12, 1, true),
          new THREE.MeshBasicMaterial({ color: '#fff2bf', transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
        rays.position.y = -0.55;
        rays.visible = lightEmits(strip);
        light.add(rays);
        addSelectable(light, {
          type: 'light', roomId: room.id, controllerId: controller.id,
          floor: controller.floor, targetId: strip.id
        }, floorGroup);
        const roomVisual = visuals.get(room.id);
        if (roomVisual) {
          roomVisual.lights ??= [];
          roomVisual.lights.push(light);
        }
        wireTargets.push({ position: light.position, color: '#fbbf24', offset: 0 });
      }
      if (!designView && room.lightStrips.length === 4) {
        room.lightStrips.forEach((strip, index) => {
          const marker = new THREE.Mesh(new THREE.SphereGeometry(0.09),
            new THREE.MeshStandardMaterial({ color: lightVisualState(strip).color }));
          marker.position.set(area.x + (index % 2 === 0 ? -0.75 : 0.75), y + 1.02,
            area.z + (index < 2 ? -0.8 : 0.8));
          floorGroup.add(marker);
        });
      }
      const faulted = Boolean(sensorFaultForRoom(controller, room));
      const appearance = selectedRoomVisualState(room.presence, faulted);
      const coincident = designRoom && (sensorLocations.get(`${designRoom.sensor.x},${designRoom.sensor.z}`) ?? 0) > 1;
      const shift = (center: number, position: number): number =>
        coincident ? Math.sign(center - position) * Math.min(0.3, Math.abs(center - position)) : 0;
      const shiftX = shift(area.x, fixtures.sensor.x);
      const shiftZ = shift(area.z, fixtures.sensor.z);
      const shiftY = coincident ? sensorRadius : 0;
      const sensor = new THREE.Mesh(new THREE.SphereGeometry(sensorRadius, 18, 12),
        new THREE.MeshStandardMaterial({ color: appearance.sensorColor, emissive: appearance.sensorEmissive }));
      sensor.position.set(fixtures.sensor.x + shiftX, fixtures.sensor.y + shiftY, fixtures.sensor.z + shiftZ);
      addSelectable(sensor, {
        type: 'sensor', roomId: room.id, controllerId: controller.id,
        floor: controller.floor, targetId: room.sensorId
      }, floorGroup);
      const roomVisual = visuals.get(room.id);
      if (roomVisual) {
        roomVisual.sensor = sensor;
        roomVisual.faulted = faulted;
      }
      const offset = 0.22 + 0.38 * roomIndex / Math.max(1, controller.rooms.length - 1);
      wireTargets.push({
        position: {
          x: fixtures.sensorConnection.x + shiftX, y: fixtures.sensorConnection.y + shiftY,
          z: fixtures.sensorConnection.z + shiftZ
        },
        color: faulted ? '#ef4444' : '#38bdf8',
        offset, port: {
          x: 0.05 + 0.17 * (roomIndex + 1) / (controller.rooms.length + 1),
          z: 0.05 + 0.1 * (roomIndex + 1) / (controller.rooms.length + 1)
        }, faulted
      });
    }
    if (wireGroup.visible) {
      wireTargets.forEach(target => addWire(wireGroup, controllerBox, target, y));
    }
    if (design && floorAccess?.stairs != null) {
      if (floorNumbers.has(controller.floor + 1)) {
        for (const stair of floorAccess.stairs) {
          floorGroup.add(createDesignStair(stair, design.width, design.depth, y,
            floor === null ? 'full' : 'outgoing'));
        }
      }
    } else {
      const stairs = createFloorStairs(y, controller.floor === highestFloor, floor === null, controller.floor);
      if (editedDesign) positionDesignStairs(stairs, editedDesign.depth, designWalkwayWidth);
      floorGroup.add(stairs);
    }
    if (floor !== null && floorNumbers.has(controller.floor - 1)) {
      if (design && previousAccess?.stairs != null) {
        for (const stair of previousAccess.stairs) {
          floorGroup.add(createDesignStair(stair, design.width, design.depth, y - 2.45, 'incoming'));
        }
      } else {
        const incoming = createIncomingFloorStairs(y, controller.floor);
        if (editedDesign) positionDesignStairs(incoming, editedDesign.depth, designWalkwayWidth);
        floorGroup.add(incoming);
      }
    }
  }
  if (editedDesign) {
    for (const controller of controllers) {
      if (floor !== null && floor !== controller.floor) continue;
      const group = building.children.find(child => child.children.some(object =>
        selectionFromUserData(object.userData)?.controllerId === controller.id));
      const pillars = createDesignFloorPillars((controller.floor - 1) * 2.45,
        controller.floor === highestFloor, editedDesign.width, editedDesign.depth, 0);
      group?.add(pillars);
    }
  } else if (floor === null) {
    controllers.forEach(controller => building.add(createFloorPillars(
      (controller.floor - 1) * 2.45, controller.floor === highestFloor)));
  }
  return { building, selectable, visuals };
  } catch (error: unknown) {
    disposeGroup(building);
    throw error;
  }
}

export function SceneCanvas({
  controllers, design, floor, selectedRoomId, wiring, onSelect, onError, onReady,
  onRendererError, onRendererReady, cameraResetVersion
}: SceneCanvasProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const contextRef = useRef<SceneContext | null>(null);
  const selectionCallback = useRef<SceneCanvasProps['onSelect']>(onSelect);
  const errorCallback = useRef<SceneCanvasProps['onError']>(onError);
  const readyCallback = useRef<SceneCanvasProps['onReady']>(onReady);
  const rendererErrorCallback = useRef<SceneCanvasProps['onRendererError']>(onRendererError);
  const rendererReadyCallback = useRef<SceneCanvasProps['onRendererReady']>(onRendererReady);
  selectionCallback.current = onSelect;
  errorCallback.current = onError;
  readyCallback.current = onReady;
  rendererErrorCallback.current = onRendererError;
  rendererReadyCallback.current = onRendererReady;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let renderer: THREE.WebGLRenderer | undefined;
    let scene: THREE.Scene | undefined;
    let camera: THREE.PerspectiveCamera | undefined;
    let controls: OrbitControls | undefined;
    let building: THREE.Group | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let frame = 0;
    let failed = false;
    let elapsed = 0;
    const reportFailure = (reason: unknown): void => {
      if (failed) return;
      failed = true;
      cancelAnimationFrame(frame);
      rendererErrorCallback.current(toError(reason));
    };
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      scene = new THREE.Scene();
      scene.background = new THREE.Color('#111827');
      camera = new THREE.PerspectiveCamera(42, 1, 0.1, 1000);
      camera.position.set(13, 14, 18);
      controls = new OrbitControls(camera, renderer.domElement);
      controls.target.set(0, 3.3, 0);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.minDistance = 8;
      controls.maxDistance = 42;
      controls.maxPolarAngle = Math.PI * 0.48;
      controls.addEventListener('start', () => {
        if (contextRef.current) contextRef.current.presetCamera = false;
      });
      scene.add(new THREE.HemisphereLight('#d9e8ff', '#18202f', 2.2));
      const keyLight = new THREE.DirectionalLight('#ffffff', 2.2);
      keyLight.position.set(8, 18, 12);
      scene.add(keyLight);
      building = new THREE.Group();
      scene.add(building);
      contextRef.current = {
        renderer, scene, camera, controls, building, currentFloor: floor,
        presetCamera: false, sceneReady: false, selectable: [], visuals: new Map<string, RoomVisual>()
      };
      let previousWidth = window.innerWidth;
      const resize = (): void => {
        const { width, height } = canvas.getBoundingClientRect();
        if (!width || !height) return;
        const activeRenderer = renderer;
        const activeCamera = camera;
        const activeControls = controls;
        if (!activeRenderer || !activeCamera || !activeControls) return;
        activeRenderer.setSize(width, height, false);
        activeCamera.aspect = width / height;
        activeCamera.fov = fieldOfViewForAspect(activeCamera.aspect);
        activeCamera.updateProjectionMatrix();
        const current = contextRef.current;
        if (current?.presetCamera && current.currentFloor !== null &&
            (previousWidth > 760) !== (window.innerWidth > 760)) {
          const { position, target } = selectedFloorCamera(current.currentFloor, window.innerWidth);
          const scale = current.designScale ?? 1;
          activeCamera.position.set(position.x * scale,
            target.y + (position.y - target.y) * scale, position.z * scale);
          activeControls.target.set(target.x, target.y, target.z);
          activeControls.update();
        }
        previousWidth = window.innerWidth;
      };
      resizeObserver = new ResizeObserver(() => {
        try {
          resize();
        } catch (error: unknown) {
          reportFailure(error);
        }
      });
      resizeObserver.observe(canvas);
      resize();
    } catch (error: unknown) {
      resizeObserver?.disconnect();
      controls?.dispose();
      if (building) disposeGroup(building);
      renderer?.dispose();
      contextRef.current = null;
      rendererErrorCallback.current(toError(error));
      return undefined;
    }
    let pointerDown: { pointerId: number; x: number; y: number } | null = null;
    const activeTouchPointers = new Set<number>();
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    const down = (event: PointerEvent): void => {
      if (event.pointerType === 'touch') {
        activeTouchPointers.add(event.pointerId);
        if (activeTouchPointers.size > 1) {
          pointerDown = null;
          return;
        }
      }
      if (event.button === 0) {
        pointerDown = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
      }
    };
    const up = (event: PointerEvent): void => {
      if (event.pointerType === 'touch') activeTouchPointers.delete(event.pointerId);
      if (!pointerDown || pointerDown.pointerId !== event.pointerId) return;
      const moved = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y);
      pointerDown = null;
      if (event.button !== 0 || moved >= 5) return;
      const bounds = canvas.getBoundingClientRect();
      pointer.set(((event.clientX - bounds.left) / bounds.width) * 2 - 1,
        -((event.clientY - bounds.top) / bounds.height) * 2 + 1);
      const activeCamera = camera;
      if (!activeCamera) return;
      raycaster.setFromCamera(pointer, activeCamera);
      const hit = raycaster.intersectObjects(contextRef.current?.selectable ?? [], false)[0];
      const selected = selectionForPointerUp(event.button, moved, hit?.object);
      selectionCallback.current(selected);
    };
    const cancel = (event: PointerEvent): void => {
      if (event.pointerType === 'touch') activeTouchPointers.delete(event.pointerId);
      if (pointerDown?.pointerId === event.pointerId) pointerDown = null;
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', cancel);
    const contextLost = (event: Event): void => {
      event.preventDefault();
      reportFailure(new Error(t('webglContextLost')));
    };
    canvas.addEventListener('webglcontextlost', contextLost, false);
    let firstRenderComplete = false;
    const animate = (): void => {
      if (failed) return;
      elapsed += 16;
      try {
        for (const visual of contextRef.current?.visuals.values() ?? []) {
          if (!visual.sensor) continue;
          const pulse = sensorPulseAmount(visual.faulted ?? false, reducedMotion.matches, elapsed);
          visual.sensor.scale.setScalar(1 + pulse * 0.16);
          visual.sensor.material.emissiveIntensity = 1 + pulse * 1.25;
        }
        const activeRenderer = renderer;
        const activeScene = scene;
        const activeCamera = camera;
        const activeControls = controls;
        if (!activeRenderer || !activeScene || !activeCamera || !activeControls) return;
        activeControls.update();
        activeRenderer.render(activeScene, activeCamera);
        if (!firstRenderComplete && contextRef.current?.sceneReady) {
          firstRenderComplete = true;
          rendererReadyCallback.current?.();
        }
        frame = requestAnimationFrame(animate);
      } catch (error: unknown) {
        reportFailure(error);
      }
    };
    animate();
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', cancel);
      canvas.removeEventListener('webglcontextlost', contextLost, false);
      controls.dispose();
      disposeGroup(building);
      renderer.dispose();
      contextRef.current = null;
    };
  }, []);

  useEffect(() => {
    const context = contextRef.current;
    if (!context) return;
    context.sceneReady = false;
    disposeGroup(context.building);
    if (controllers.length === 0) {
      context.selectable = [];
      context.visuals = new Map<string, RoomVisual>();
      context.sceneReady = true;
      readyCallback.current?.();
      return;
    }
    try {
      const next = buildBuilding({ controllers, design, floor, selectedRoomId, wiring });
      context.building.add(next.building);
      context.selectable = next.selectable;
      context.visuals = next.visuals;
      context.sceneReady = true;
      readyCallback.current?.();
    } catch (error) {
      disposeGroup(context.building);
      context.selectable = [];
      context.visuals = new Map<string, RoomVisual>();
      errorCallback.current?.(toError(error));
    }
  }, [controllers, design, floor, selectedRoomId, wiring]);

  useEffect(() => {
    const context = contextRef.current;
    if (!context || controllers.length === 0) return;
    const hasEditedDesign = design !== null;
    const highestFloor = Math.max(...controllers.map(item => item.floor));
    const scale = hasEditedDesign
      ? floor === null
        ? overviewCameraScale(design.width, design.depth, highestFloor)
        : Math.max(1, design.width / 10, design.depth / 8)
      : 1;
    context.controls.maxDistance = 42 * scale;
    context.currentFloor = floor;
    context.designScale = scale;
    context.presetCamera = true;
    const targetY = floor === null
      ? hasEditedDesign ? (highestFloor - 1) * 2.45 / 2 : 3.3
      : (floor - 1) * 2.45 + 0.3;
    if (floor === null) {
      context.camera.position.set(13 * scale, targetY + 10.7 * scale, 18 * scale);
      context.controls.target.set(0, targetY, 0);
    } else {
      const { position, target } = selectedFloorCamera(floor, window.innerWidth);
      context.camera.position.set(position.x * scale,
        target.y + (position.y - target.y) * scale, position.z * scale);
      context.controls.target.set(target.x, target.y, target.z);
    }
    context.controls.update();
  }, [cameraResetVersion, controllers.length, design?.revision, floor]);

  return <canvas ref={canvasRef} className="simulator-canvas" role="img"
    aria-label={t('simulatorCanvas')} />;
}
