import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { isWiringVisible, wiringRoute } from './wiring-routes.mjs?v=wiring-7';
import { FloorView, applyFloorMaterialEmphasis, fieldOfViewForAspect, selectedFloorCamera, cameraPresetNeedsUpdate, isFloorVisible, floorNavigation } from './floor-view.mjs?v=floor-navigation-5';
import { createFloorPillars } from './building-pillars.mjs?v=pillars-2';
import { createFloorSlab, createFloorStairLandings, createFloorStairs, createIncomingFloorStairs } from './building-stairs.mjs?v=stairs-8';
import { createFloorWalkway, createOpenDoor, roomWallSegments } from './building-access.mjs?v=access-2';
import { floorRoomLayout, roomFixturePositions, sensorRadius } from './room-fixtures.mjs?v=room-access-4';
import { lightEmits, lightVisualState, roomIllumination, selectedRoomVisualState, sensorFaultForRoom, sensorPulseAmount } from './room-state.mjs?v=7';
import { controllerStatusLabel, localizeMarkup, t } from './localization.en.mjs?v=1';

localizeMarkup(document);

const canvas = document.querySelector('#buildingCanvas');
const building = new THREE.Group();
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 150);
const scene = new THREE.Scene();
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
const controls = new OrbitControls(camera, renderer.domElement);
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const selectable = [];
const floorGroups = new Map();
const floorView = new FloorView();
let activeFloorGroup = null;
let controllers = [];
let selection = null;
let selectedRoomId = null;
let refreshSequence = 0;
let lastAppliedRefresh = 0;
let minimumRefreshSequence = 0;
let scenarioWarningAfterRefresh = null;
let actionWarningAfterRefresh = null;
let pointerDown = null;
let initialSelectionPending = true;
let startupCameraPending = true;
let cameraPresetActive = false;
let cameraInteractionActive = false;
let previousViewportWidth = window.innerWidth;
const roomVisuals = new Map();
const coarsePointer = matchMedia('(pointer: coarse)');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
scene.background = new THREE.Color('#111827');
camera.position.set(13, 14, 18);
scene.add(new THREE.HemisphereLight('#d9e8ff', '#18202f', 2.2));
const keyLight = new THREE.DirectionalLight('#ffffff', 2.2);
keyLight.position.set(8, 18, 12);
scene.add(keyLight);
scene.add(building);

controls.target.set(0, 3.3, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 8;
controls.maxDistance = 42;
controls.maxPolarAngle = Math.PI * 0.48;
controls.addEventListener('start', () => { cameraInteractionActive = true; });
controls.addEventListener('change', () => {
  if (cameraInteractionActive) cameraPresetActive = false;
});
controls.addEventListener('end', () => { cameraInteractionActive = false; });

function updateRendererSize() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.fov = fieldOfViewForAspect(camera.aspect);
  camera.updateProjectionMatrix();
}

function addToFloor(object) {
  (activeFloorGroup ?? building).add(object);
  return object;
}

function addSelectable(mesh, data) {
  mesh.userData.selection = data;
  selectable.push(mesh);
  return addToFloor(mesh);
}

function addWall(x1, z1, x2, z2, y, height, roomId, controllerId, floor) {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(Math.hypot(dx, dz), height, 0.12),
    new THREE.MeshStandardMaterial({
      color: '#94a3b8',
      roughness: 0.75,
      emissive: '#000000',
      emissiveIntensity: 0
    }));
  wall.position.set((x1 + x2) / 2, y + height / 2, (z1 + z2) / 2);
  wall.rotation.y = -Math.atan2(dz, dx);
  wall.userData.roomId = roomId;
  addSelectable(wall, { type: 'room', roomId, controllerId, floor });
  const visual = roomVisuals.get(roomId);
  if (visual) {
    applyWallLighting(wall, false, visual.illumination);
    visual.walls.push(wall);
  }
}

function applyWallLighting(wall, selected, illumination) {
  const strength = illumination;
  wall.material.emissive.set(selected ? '#0c4a6e' : '#000000');
  wall.material.emissive.lerp(new THREE.Color('#d49a46'), strength * 0.45);
  wall.material.emissiveIntensity = (selected ? 0.32 : 0) + strength * 0.35;
}

function createLightRays() {
  const vertices = [];
  const uvs = [];
  const indices = [];
  for (const [x, z] of [[1, 0], [0, 1], [0.707, 0.707]]) {
    const offset = vertices.length / 3;
    vertices.push(
      -x * 0.18, -0.06, -z * 0.18,
      x * 0.18, -0.06, z * 0.18,
      x * 0.7, -1.08, z * 0.7,
      -x * 0.7, -1.08, -z * 0.7
    );
    uvs.push(0, 1, 1, 1, 1, 0, 0, 0);
    indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  const material = new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    vertexShader: `
      varying vec2 rayUv;
      void main() {
        rayUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 rayUv;
      void main() {
        float edge = sin(3.14159265 * rayUv.x);
        float fade = smoothstep(0.0, 0.3, rayUv.y);
        gl_FragColor = vec4(1.0, 0.95, 0.75, 0.45 * edge * edge * fade);
      }
    `
  });
  material.userData.preserveTransparency = true;
  return new THREE.Mesh(geometry, material);
}

function disposeBuilding() {
  building.traverse(object => {
    if (!object.isMesh && !object.isLine) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach(material => {
      material.map?.dispose();
      material.dispose();
    });
  });
  building.clear();
}

function rebuildBuilding() {
  disposeBuilding();
  selectable.length = 0;
  floorGroups.clear();
  roomVisuals.clear();
  const highestFloor = Math.max(...controllers.map(controller => controller.floor));
  const floorNumbers = new Set(controllers.map(controller => controller.floor));

  controllers.forEach(controller => {
    if (!isFloorVisible(floorView.current, controller.floor)) return;
    const y = (controller.floor - 1) * 2.45;
    const floorGroup = new THREE.Group();
    floorGroup.userData.floor = controller.floor;
    floorGroup.userData.controllerId = controller.id;
    floorGroups.set(controller.floor, floorGroup);
    building.add(floorGroup);
    activeFloorGroup = floorGroup;
    const wiringGroup = new THREE.Group();
    wiringGroup.visible = isWiringVisible(floorView.current, controller.floor);
    floorGroup.add(wiringGroup);
    const wiringTargets = [];

    const incomingFloor = floorView.current !== null && controller.floor === highestFloor
      ? controller.floor - 1 : null;
    for (const slab of createFloorSlab(y, floorNumbers.has(controller.floor - 1), incomingFloor)) {
      addSelectable(slab, { type: 'floor', controllerId: controller.id, floor: controller.floor });
    }
    for (const landing of createFloorStairLandings(y, controller.floor)) {
      addSelectable(landing, { type: 'floor', controllerId: controller.id, floor: controller.floor });
    }
    addSelectable(createFloorWalkway(y), { type: 'floor', controllerId: controller.id, floor: controller.floor });

    const floorLabel = new THREE.Mesh(
      new THREE.PlaneGeometry(1.35, 0.42),
      new THREE.MeshBasicMaterial({ map: textTexture(t('floorSceneLabel', { floor: controller.floor })), side: THREE.DoubleSide }));
    floorLabel.position.set(-4.45, y + 0.62, 4.06);
    addSelectable(floorLabel, { type: 'floor', controllerId: controller.id, floor: controller.floor });

    const layout = floorRoomLayout(controller.floor,
      controller.rooms.map(room => room.id.slice(`floor-${controller.floor}-`.length)));

    controller.rooms.forEach(room => {
      const roomKey = room.id.slice(`floor-${controller.floor}-`.length);
      const area = layout[roomKey];
      if (!area) return;
      const roomSelection = { type: 'room', roomId: room.id, controllerId: controller.id, floor: controller.floor };
      const surface = new THREE.Mesh(
        new THREE.BoxGeometry(area.width - 0.12, 0.05, area.depth - 0.12),
        new THREE.MeshStandardMaterial({
          color: selection?.roomId === room.id ? '#1e3a5f' : '#475569',
          emissive: '#ffbd55',
          emissiveIntensity: 0.32 * roomIllumination(room.lightStrips),
          roughness: 0.92,
          side: THREE.DoubleSide
        }));
      surface.position.set(area.x, y + 0.015, area.z);
      addSelectable(surface, roomSelection);

      const selected = selection?.roomId === room.id;
      const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(area.width - 0.06, 0.08, area.depth - 0.06)),
        new THREE.LineBasicMaterial({
          color: selected ? '#38bdf8' : '#64748b',
          transparent: !selected,
          opacity: selected ? 1 : 0
        }));
      outline.position.set(area.x, y + 0.08, area.z);
      addToFloor(outline);
      roomVisuals.set(room.id, {
        surface, outline, walls: [], sensor: null, lights: [], sensorFaulted: false,
        illumination: roomIllumination(room.lightStrips)
      });

      for (const wall of roomWallSegments(area)) {
        addWall(wall.x1, wall.z1, wall.x2, wall.z2, y + wall.y, wall.height,
          room.id, controller.id, controller.floor);
      }
      addSelectable(createOpenDoor(area, y), roomSelection);

      const roomName = new THREE.Mesh(
        new THREE.PlaneGeometry(Math.min(area.width * 0.72, 2.6), 0.48),
        new THREE.MeshBasicMaterial({ map: textTexture(room.name.toUpperCase()), side: THREE.DoubleSide, depthWrite: false }));
      roomName.position.set(area.x, y + 0.64, area.z + area.depth / 2 + 0.07);
      addToFloor(roomName);

      const roomKeySensor = `sensor-floor-${controller.floor}-${roomKey}`;
      const fixtures = roomFixturePositions(area, y, room.lightStrips.length);

      room.lightStrips.forEach((strip, index) => {
        const light = new THREE.Mesh(
          new THREE.BoxGeometry(room.lightStrips.length >= 4 ? 1.1 : 1.7, 0.09, 0.22),
          new THREE.MeshStandardMaterial(lightVisualState(strip)));
        const rays = createLightRays();
        rays.visible = lightEmits(strip);
        light.add(rays);
        light.userData.rays = rays;
        const position = fixtures.lights[index];
        light.position.set(position.x, position.y, position.z);
        wiringTargets.push({ position: light.position, color: '#fbbf24', offset: 0 });
        addSelectable(light, { type: 'light', roomId: room.id, controllerId: controller.id, targetId: strip.id, floor: controller.floor });
        roomVisuals.get(room.id).lights.push(light);
      });

      const sensorFaulted = Boolean(sensorFaultForRoom(controller, room));
      const sensorAppearance = selectedRoomVisualState(room.presence, sensorFaulted);
      const sensor = new THREE.Mesh(
        new THREE.SphereGeometry(sensorRadius, 18, 12),
        new THREE.MeshStandardMaterial({
          color: sensorAppearance.sensorColor,
          emissive: sensorAppearance.sensorEmissive
        }));
      sensor.position.set(fixtures.sensor.x, fixtures.sensor.y, fixtures.sensor.z);
      wiringTargets.push({ position: fixtures.sensorConnection, color: '#38bdf8', offset: 0.22 });
      addSelectable(sensor, {
        type: 'sensor',
        roomId: room.id,
        controllerId: controller.id,
        targetId: roomKeySensor,
        floor: controller.floor
      });
      roomVisuals.get(room.id).sensor = sensor;
      roomVisuals.get(room.id).sensorFaulted = sensorFaulted;

      if (room.lightStrips.length === 4) {
        room.lightStrips.forEach((strip, index) => {
          const marker = new THREE.Mesh(
            new THREE.SphereGeometry(0.09),
            new THREE.MeshStandardMaterial({ color: strip.isFaulted ? '#ef4444' : strip.isOn ? '#fde047' : '#94a3b8' }));
          marker.position.set(area.x + (index % 2 === 0 ? -0.75 : 0.75), y + 1.02, area.z + (index < 2 ? -0.8 : 0.8));
          addToFloor(marker);
        });
      }
    });

    const controllerBox = new THREE.Mesh(
      new THREE.BoxGeometry(0.58, 0.58, 0.42),
      new THREE.MeshStandardMaterial({ color: controller.status === 'Faulted' ? '#ef4444' : '#22c55e' }));
    controllerBox.position.set(-4.65, y + 0.38, -3.4);
    addSelectable(controllerBox, { type: 'controller', controllerId: controller.id, roomId: controller.rooms[0]?.id, floor: controller.floor });

    wiringTargets.forEach(target => {
      const points = wiringRoute(controllerBox.position, target.position, y + 1.4, target.offset);
      const route = new THREE.CurvePath();
      for (let index = 1; index < points.length; index++) {
        route.add(new THREE.LineCurve3(
          new THREE.Vector3(points[index - 1].x, points[index - 1].y, points[index - 1].z),
          new THREE.Vector3(points[index].x, points[index].y, points[index].z)));
      }
      const wire = new THREE.Mesh(
        new THREE.TubeGeometry(route, 32, 0.035, 6, false),
        new THREE.MeshStandardMaterial({ color: target.color, emissive: target.color, emissiveIntensity: 0.45 }));
      wiringGroup.add(wire);
    });
    floorGroup.add(createFloorStairs(y, controller.floor === highestFloor, floorView.current === null, controller.floor));
    if (floorView.current !== null && floorNumbers.has(controller.floor - 1)) {
      floorGroup.add(createIncomingFloorStairs(y, controller.floor));
    }
  });

  activeFloorGroup = null;
  applyFloorEmphasis();
  if (floorView.current === null) {
    controllers.forEach(controller => {
      floorGroups.get(controller.floor).add(createFloorPillars(
        (controller.floor - 1) * 2.45, controller.floor === highestFloor));
    });
  }
}

function applyFloorEmphasis() {
  floorGroups.forEach((group, floor) => {
    const dimmed = floorView.current !== null && floor !== floorView.current;
    group.traverse(object => {
      if (!object.isMesh) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach(material => {
        applyFloorMaterialEmphasis(material, dimmed);
      });
    });
  });
}

function currentRoom() {
  return controllers.flatMap(controller => controller.rooms).find(room => room.id === selection?.roomId) ?? null;
}

function currentController() {
  return controllers.find(controller => controller.id === selection?.controllerId);
}

function textTexture(text) {
  const labelCanvas = document.createElement('canvas');
  labelCanvas.width = 512;
  labelCanvas.height = 96;
  const context = labelCanvas.getContext('2d');
  context.fillStyle = '#0f172a';
  context.fillRect(0, 0, labelCanvas.width, labelCanvas.height);
  context.fillStyle = '#e2e8f0';
  context.font = 'bold 48px system-ui, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, labelCanvas.width / 2, labelCanvas.height / 2, labelCanvas.width - 32);
  const texture = new THREE.CanvasTexture(labelCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function updateFloorStatus() {
  document.querySelector('#wiringLegend').hidden = floorView.current === null;
  document.querySelector('#floorSelectionHint').textContent = t('floorSelectionHint');
  const floorButtons = document.querySelector('#floorButtons');
  const orderedControllers = floorNavigation(controllers, floorView.current);
  const existingButtons = [...floorButtons.children];
  if (existingButtons.length !== orderedControllers.length ||
      orderedControllers.some((controller, index) => existingButtons[index].dataset.controllerId !== controller.id)) {
    floorButtons.replaceChildren(...orderedControllers.map(controller => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'floor-button';
      button.dataset.controllerId = controller.id;
      const name = document.createElement('span');
      name.className = 'floor-button-name';
      name.textContent = t('floorName', { floor: controller.floor });
      const status = document.createElement('span');
      status.className = 'floor-button-status';
      const faultIcon = document.createElement('span');
      faultIcon.className = 'floor-fault-icon';
      faultIcon.setAttribute('aria-hidden', 'true');
      faultIcon.textContent = '\u26a0';
      const statusText = document.createElement('span');
      statusText.className = 'floor-status-text';
      status.append(faultIcon, statusText);
      const occupancy = document.createElement('span');
      occupancy.className = 'floor-button-occupancy';
      const occupancyIcon = document.createElement('span');
      occupancyIcon.className = 'floor-occupancy-icon';
      occupancyIcon.setAttribute('aria-hidden', 'true');
      occupancyIcon.textContent = '\u{1f464}\ufe0e';
      const occupancyText = document.createElement('span');
      occupancyText.className = 'floor-occupancy-text';
      occupancy.append(occupancyIcon, occupancyText);
      button.append(name, status, occupancy);
      return button;
    }));
  }
  orderedControllers.forEach((controller, index) => {
    const button = floorButtons.children[index];
    const selected = controller.selected;
    button.setAttribute('aria-pressed', String(selected));
    const status = button.querySelector('.floor-button-status');
    status.querySelector('.floor-status-text').textContent = controllerStatusLabel(controller.status);
    status.querySelector('.floor-fault-icon').hidden = controller.status !== 'Faulted';
    status.classList.toggle('faulted', controller.status === 'Faulted');
    button.querySelector('.floor-occupancy-text').textContent =
      t('occupiedRooms', { occupied: controller.occupiedRooms, total: controller.totalRooms });
  });
  document.querySelector('#floorLoading').hidden = controllers.length > 0;
  const floorSelector = document.querySelector('#accessibleFloor');
  const floorValues = ['', ...controllers.map(controller => String(controller.floor))];
  if (floorValues.length !== floorSelector.options.length ||
      floorValues.some((value, index) => floorSelector.options[index].value !== value)) {
    floorSelector.replaceChildren(new Option(t('allFloors'), ''));
    controllers.forEach(controller => floorSelector.add(new Option(t('floorNameOption', { floor: controller.floor }), String(controller.floor))));
  }
  floorSelector.value = floorView.current === null ? '' : String(floorView.current);
  floorSelector.disabled = controllers.length === 0;
  document.querySelector('#showAllFloors').disabled = controllers.length === 0;
  document.querySelector('#showAllFloors').setAttribute('aria-pressed', String(floorView.current === null));
  document.querySelectorAll('#statusTable tr[data-floor]').forEach(row => {
    row.classList.toggle('selected-floor', Number(row.dataset.floor) === floorView.current);
  });
}

function syncRoomInspector() {
  const inspector = document.querySelector('#roomInspector');
  const room = currentRoom();
  const controller = currentController();
  if (!room || !controller) {
    inspector.hidden = true;
    return;
  }

  floorView.select(controller.floor);
  updateFloorStatus();
  inspector.hidden = false;
  document.querySelector('#roomInspectorTitle').textContent =
    t('floorRoomName', { floor: controller.floor, room: room.name });
  const sensorFaulted = Boolean(sensorFaultForRoom(controller, room));
  document.querySelector('#inspectorPresence').checked = room.presence;
  document.querySelector('#inspectorFault').checked = sensorFaulted;
  applyRoomVisualSelection(room.id);
  applyRoomVisualState(room, sensorFaulted);
}

function applyRoomVisualSelection(roomId) {
  roomVisuals.forEach((visual, id) => {
    visual.outline.material.color.set(id === roomId ? '#38bdf8' : '#64748b');
    visual.outline.material.opacity = id === roomId ? 1 : 0;
    visual.outline.material.transparent = id !== roomId;
    visual.surface.material.color.set(id === roomId ? '#1e3a5f' : '#475569');
    visual.walls?.forEach(wall => {
      wall.material.color.set(id === roomId ? '#38bdf8' : '#94a3b8');
      applyWallLighting(wall, id === roomId, visual.illumination);
    });
  });
}

function applyRoomVisualState(room, faulted) {
  const visual = roomVisuals.get(room.id);
  if (!visual) return;
  const presence = room.presence;
  const appearance = selectedRoomVisualState(presence, faulted);
  visual.illumination = roomIllumination(room.lightStrips);
  visual.surface.material.emissiveIntensity = 0.32 * visual.illumination;
  visual.surface.material.color.set(appearance.surfaceColor);
  visual.outline.material.color.set(appearance.outlineColor);
  visual.walls?.forEach(wall => {
    wall.material.color.set(appearance.wallColor);
    applyWallLighting(wall, true, visual.illumination);
  });
  if (visual.sensor) {
    visual.sensor.material.color.set(appearance.sensorColor);
    visual.sensor.material.emissive.set(appearance.sensorEmissive);
  }
  visual.lights.forEach((light, index) => {
    const state = lightVisualState(room.lightStrips[index]);
    light.material.color.set(state.color);
    light.material.emissive.set(state.emissive);
    light.material.emissiveIntensity = state.emissiveIntensity;
    light.userData.rays.visible = lightEmits(room.lightStrips[index]);
  });
  visual.sensorFaulted = faulted;
}

function replaceOptions(select, options) {
  select.replaceChildren(...options.map(option => {
    const element = document.createElement('option');
    element.value = option.id;
    element.textContent = option.label;
    return element;
  }));
}

function createFaultRow(controller, fault, list, errorTarget) {
  const row = document.createElement('div');
  row.className = 'fault';
  const label = document.createElement('span');
  label.textContent = `${controller.id}: ${fault.scope} — ${fault.description}`;
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.textContent = t('clear');
  clear.addEventListener('click', () => clearFault(controller, fault, errorTarget));
  row.append(label, clear);
  list.append(row);
}

function renderFaults(controller, list) {
  list.replaceChildren();
  if (!controller?.faults.length) {
    list.textContent = t('noActiveFaults');
    return;
  }
  controller.faults.forEach(fault => createFaultRow(controller, fault, list, '#actionError'));
}

function renderAccessibleFaults() {
  const list = document.querySelector('#accessibleFaults');
  list.replaceChildren();
  const faults = controllers.flatMap(controller => controller.faults.map(fault => ({ controller, fault })));
  if (!faults.length) {
    list.textContent = t('noActiveFaults');
    return;
  }
  faults.forEach(({ controller, fault }) => createFaultRow(controller, fault, list, '#accessibleError'));
}

function renderStatus() {
  const table = document.createElement('table');
  const head = document.createElement('thead');
  const headingRow = document.createElement('tr');
  ['controller', 'floor', 'status', 'statusTableHeader'].forEach(key => {
    const heading = document.createElement('th');
    heading.textContent = t(key);
    headingRow.append(heading);
  });
  head.append(headingRow);
  const body = document.createElement('tbody');
  controllers.forEach(controller => {
    const row = document.createElement('tr');
    row.dataset.floor = String(controller.floor);
    row.classList.toggle('selected-floor', controller.floor === floorView.current);
    const cells = [
      controller.id,
      String(controller.floor),
      controllerStatusLabel(controller.status),
      controller.rooms.map(room => t('roomLightsOn', {
        room: room.name,
        on: room.lightStrips.filter(lightEmits).length,
        total: room.lightStrips.length
      })).join(' · ')
    ];
    cells.forEach(value => {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    });
    body.append(row);
  });
  table.append(head, body);
  document.querySelector('#statusTable').replaceChildren(table);
}

function populateAccessibleControls() {
  const rooms = controllers.flatMap(controller => controller.rooms);
  const selectedRoom = document.querySelector('#accessibleRoom').value;
  replaceOptions(document.querySelector('#accessibleRoom'), rooms.map(room => ({
    id: room.id,
    label: t('roomTarget', { controller: room.controllerId, room: room.name })
  })));
  if (rooms.some(room => room.id === selectedRoom)) document.querySelector('#accessibleRoom').value = selectedRoom;
  populateAccessibleFaultTargets();
}

function populateAccessibleFaultTargets() {
  const scope = document.querySelector('#accessibleFaultScope').value;
  let options = [];
  if (scope === 'sensor') {
    options = controllers.flatMap(controller => controller.rooms.map(room => {
      const key = room.id.slice(`floor-${controller.floor}-`.length);
      return { id: `sensor-floor-${controller.floor}-${key}`, label: t('sensorTarget', { floor: controller.floor, room: room.name }) };
    }));
  } else if (scope === 'light') {
    options = controllers.flatMap(controller => controller.rooms.flatMap(room =>
      room.lightStrips.map((strip, index) => ({
        id: strip.id,
        label: t('lightTarget', { floor: controller.floor, room: room.name, strip: index + 1 })
      }))));
  } else {
    options = controllers.map(controller => ({ id: controller.id, label: t('controllerTarget', { floor: controller.floor }) }));
  }
  replaceOptions(document.querySelector('#accessibleFaultTarget'), options);
}

function ownerForTarget(scope, targetId) {
  return controllers.find(controller =>
    scope === 'controller'
      ? controller.id === targetId
      : scope === 'sensor'
        ? controller.rooms.some(room => `sensor-floor-${controller.floor}-${room.id.slice(`floor-${controller.floor}-`.length)}` === targetId)
        : controller.rooms.some(room => room.lightStrips.some(strip => strip.id === targetId)));
}

function updateGestureHelp() {
  document.querySelector('#viewStatus').textContent = coarsePointer.matches
    ? t('touchGestureHelp')
    : t('mouseGestureHelp');
}

function showActionError(error, target = '#actionError') {
  const element = document.querySelector(target);
  if (element) {
    element.textContent = error.message;
    element.hidden = false;
  }
}

async function request(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(t('requestFailed', { status: response.status, body: await response.text() }));
  const loadError = document.querySelector('#loadError');
  if (loadError) loadError.hidden = true;
  const actionError = document.querySelector('#actionError');
  if (actionError) actionError.hidden = true;
  const accessibleError = document.querySelector('#accessibleError');
  if (accessibleError) accessibleError.hidden = true;
  return response;
}

function updateLocalController(updated) {
  minimumRefreshSequence = refreshSequence + 1;
  controllers = controllers.map(controller =>
    controller.id === updated.id ? updated : controller);
  rebuildBuilding();
  renderStatus();
  syncRoomInspector();
  updateFloorStatus();
  populateAccessibleControls();
  renderAccessibleFaults();
}

async function clearFault(controller, fault, errorTarget) {
  try {
    await request(`/api/devices/${controller.id}/faults/${fault.id}`, { method: 'DELETE' });
    await refreshAfterAction();
  } catch (error) {
    showActionError(error, errorTarget);
  }
}

async function refresh() {
  const sequence = ++refreshSequence;
  const [controllerResponse, statusResponse] = await Promise.all([
    fetch('/api/controllers'),
    fetch('/api/status')
  ]);
  if (!controllerResponse.ok) throw new Error(t('controllerApiFailed', { status: controllerResponse.status }));
  const updatedControllers = await controllerResponse.json();
  const transport = statusResponse.ok ? await statusResponse.json() : null;
  if (sequence < lastAppliedRefresh) return;
  if (sequence < minimumRefreshSequence) throw new Error(t('statusChangedDuringRefresh'));
  lastAppliedRefresh = sequence;
  controllers = updatedControllers;
  if (statusResponse.ok) {
    const transportStatus = document.querySelector('#transportStatus');
    transportStatus.textContent = transport.mqttConnected
      ? t('mqttConnected')
      : t('mqttUnavailableHttpActive');
    transportStatus.classList.toggle('offline', !transport.mqttConnected);
  } else {
    const transportStatus = document.querySelector('#transportStatus');
    transportStatus.textContent = t('transportStatusUnavailable');
    transportStatus.classList.add('offline');
  }
  if (initialSelectionPending) {
    const floorThree = controllers.find(controller => controller.floor === 3);
    const mainRoom = floorThree?.rooms.find(room => room.id.endsWith('-main'));
    if (floorThree && mainRoom) {
      floorView.select(3);
      selectedRoomId = mainRoom.id;
      selection = { type: 'room', roomId: mainRoom.id, controllerId: floorThree.id, floor: 3 };
    }
    initialSelectionPending = false;
  }
  if (selection?.roomId && !currentRoom()) selection = null;
  if (selection?.roomId) selectedRoomId = selection.roomId;
  rebuildBuilding();
  renderStatus();
  syncRoomInspector();
  updateFloorStatus();
  populateAccessibleControls();
  renderAccessibleFaults();
  updateGestureHelp();
  if (startupCameraPending && floorView.current === 3) {
    moveCameraToFloor(3);
    startupCameraPending = false;
  }
  if (scenarioWarningAfterRefresh !== null && sequence > scenarioWarningAfterRefresh) {
    document.querySelector('#scenarioStatusWarning').hidden = true;
    scenarioWarningAfterRefresh = null;
  }
  if (actionWarningAfterRefresh !== null && sequence > actionWarningAfterRefresh) {
    if (document.activeElement === document.querySelector('#dismissRefreshWarning')) {
      document.querySelector('#accessibleInjectFault').focus();
    }
    document.querySelector('#refreshWarning').hidden = true;
    actionWarningAfterRefresh = null;
  }
}

async function refreshAfterAction() {
  const actionRefreshSequence = refreshSequence + 1;
  try {
    await refresh();
  } catch (error) {
    if (lastAppliedRefresh <= actionRefreshSequence) {
      actionWarningAfterRefresh = refreshSequence;
      document.querySelector('#refreshWarning').hidden = false;
      showActionError(new Error(t('actionStatusRefreshFailed', { error: error.message })), '#refreshWarningText');
    }
  }
}

document.querySelector('#dismissRefreshWarning').addEventListener('click', () => {
  document.querySelector('#accessibleInjectFault').focus();
  document.querySelector('#refreshWarning').hidden = true;
});

function selectAtPointer(event) {
  const bounds = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
  pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(selectable, false)[0];
  if (!hit) {
    selection = null;
    return;
  }

  selectSceneItem(hit.object.userData.selection);
}

function selectSceneItem(picked) {
  const previousFloor = floorView.current;
  floorView.select(picked.floor);
  if (picked.type === 'floor') {
    const controller = controllers.find(candidate => candidate.floor === floorView.current);
    const mainRoom = controller?.rooms.find(room => room.id.endsWith('-main'));
    selectedRoomId = mainRoom?.id ?? controller?.rooms[0]?.id ?? null;
    selection = mainRoom
      ? { type: 'room', roomId: mainRoom.id, controllerId: controller.id, floor: controller.floor }
      : null;
  } else {
    selection = picked;
  }
  if (picked.roomId) selectedRoomId = picked.roomId;
  if (!selectedRoomId) {
    const controller = controllers.find(candidate => candidate.floor === floorView.current);
    selectedRoomId = controller?.rooms[0]?.id ?? null;
  }
  rebuildBuilding();
  renderStatus();
  syncRoomInspector();
  updateFloorStatus();
  if (previousFloor !== floorView.current) moveCameraToFloor(floorView.current);
}

canvas.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  pointerDown = { x: event.clientX, y: event.clientY };
});
canvas.addEventListener('pointerup', event => {
  if (!pointerDown) return;
  const moved = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y);
  pointerDown = null;
  if (event.button === 0 && moved < 5) selectAtPointer(event);
});

document.querySelector('#showAllFloors').addEventListener('click', () => {
  showAllFloors();
});

document.querySelector('#floorButtons').addEventListener('click', event => {
  const button = event.target.closest('button[data-controller-id]');
  if (!button) return;
  const controller = controllers.find(candidate => candidate.id === button.dataset.controllerId);
  if (!controller) {
    showActionError(new Error(t('selectedFloorUnavailable')), '#loadError');
    return;
  }
  if (floorView.current === controller.floor) {
    if (!currentRoom()) {
      selectSceneItem({ type: 'floor', controllerId: controller.id, floor: controller.floor });
    }
    moveCameraToFloor(controller.floor);
    return;
  }
  selectSceneItem({ type: 'floor', controllerId: controller.id, floor: controller.floor });
});

function showAllFloors() {
  floorView.showAll();
  selection = null;
  selectedRoomId = null;
  rebuildBuilding();
  renderStatus();
  syncRoomInspector();
  updateFloorStatus();
  moveCamera({ x: 13, y: 14, z: 18 }, { x: 0, y: 3.3, z: 0 });
}

document.querySelector('#accessibleFloor').addEventListener('change', event => {
  if (event.target.value === '') {
    showAllFloors();
    return;
  }
  const controller = controllers.find(candidate => String(candidate.floor) === event.target.value);
  if (!controller) {
    showActionError(new Error(t('selectedFloorUnavailable')), '#accessibleError');
    updateFloorStatus();
    return;
  }
  selectSceneItem({ type: 'floor', controllerId: controller.id, floor: controller.floor });
});

document.querySelector('#closeRoomInspector').addEventListener('click', () => {
  selection = null;
  selectedRoomId = null;
  rebuildBuilding();
  renderStatus();
  document.querySelector('#roomInspector').hidden = true;
});

document.querySelector('#inspectorPresence').addEventListener('change', async event => {
  const room = currentRoom();
  if (!room) return;
  try {
    const response = await request(`/api/rooms/${room.id}/sensor/${event.target.checked ? 'trigger' : 'reset'}`, { method: 'POST' });
    updateLocalController(await response.json());
  } catch (error) {
    syncRoomInspector();
    showActionError(error, '#inspectorError');
  }
});

document.querySelector('#inspectorFault').addEventListener('change', async event => {
  const room = currentRoom();
  const controller = currentController();
  if (!room || !controller) return;
  const sensorId = `sensor-floor-${controller.floor}-${room.id.slice(`floor-${controller.floor}-`.length)}`;
  const existingFault = sensorFaultForRoom(controller, room);
  try {
    let response;
    if (event.target.checked && !existingFault) {
      response = await request(`/api/devices/${controller.id}/faults`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: 'sensor',
          targetId: sensorId,
          description: t('simulatedSensorFault')
        })
      });
    } else if (!event.target.checked && existingFault) {
      response = await request(`/api/devices/${controller.id}/faults/${existingFault.id}`, { method: 'DELETE' });
    }
    if (response) updateLocalController(await response.json());
  } catch (error) {
    syncRoomInspector();
    showActionError(error, '#inspectorError');
  }
});

document.querySelector('#accessibleFaultScope').addEventListener('change', populateAccessibleFaultTargets);
document.querySelector('#accessibleTrigger').addEventListener('click', async () => {
  const roomId = document.querySelector('#accessibleRoom').value;
  try {
    await request(`/api/rooms/${roomId}/sensor/trigger`, { method: 'POST' });
    await refreshAfterAction();
  } catch (error) {
    showActionError(error, '#accessibleError');
  }
});
document.querySelector('#accessibleInjectFault').addEventListener('click', async () => {
  const scope = document.querySelector('#accessibleFaultScope').value;
  const targetId = document.querySelector('#accessibleFaultTarget').value;
  const controller = ownerForTarget(scope, targetId);
  if (!controller) return;
  try {
    await request(`/api/devices/${controller.id}/faults`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope, targetId, description: t('simulatedScopedFault', { scope }) })
    });
    await refreshAfterAction();
  } catch (error) {
    showActionError(error, '#accessibleError');
  }
});

function moveCamera(position, target) {
  cameraPresetActive = false;
  const dampingEnabled = controls.enableDamping;
  // Flush pending orbit inertia before applying the preset.
  controls.enableDamping = false;
  controls.update();
  controls.enableDamping = dampingEnabled;
  camera.position.set(position.x, position.y, position.z);
  controls.target.set(target.x, target.y, target.z);
  controls.update();
}

function moveCameraToFloor(floor) {
  const { position, target } = selectedFloorCamera(floor, window.innerWidth);
  moveCamera(position, target);
  cameraPresetActive = true;
}

async function runScenario(url) {
  const buttons = document.querySelectorAll('.scenario-controls button');
  buttons.forEach(button => { button.disabled = true; });
  document.querySelector('#scenarioError').hidden = true;
  try {
    try {
      await request(url, { method: 'POST' });
    } catch (error) {
      showActionError(error, '#scenarioError');
      return;
    }
    const scenarioRefreshSequence = refreshSequence + 1;
    try {
      await refresh();
    } catch (error) {
      if (lastAppliedRefresh <= scenarioRefreshSequence) {
        scenarioWarningAfterRefresh = refreshSequence;
        showActionError(new Error(t('scenarioStatusRefreshFailed', { error: error.message })), '#scenarioStatusWarning');
      }
    }
  } finally {
    buttons.forEach(button => { button.disabled = false; });
  }
}

document.querySelector('#scenarioReset').addEventListener('click', () => {
  runScenario('/api/scenarios/reset');
});

document.querySelector('#scenarioOccupied').addEventListener('click', () => {
  runScenario('/api/scenarios/occupancy');
});

window.addEventListener('resize', () => {
  updateRendererSize();
  updateGestureHelp();
  if (floorView.current !== null &&
      cameraPresetNeedsUpdate(previousViewportWidth, window.innerWidth, cameraPresetActive)) {
    moveCameraToFloor(floorView.current);
  }
  previousViewportWidth = window.innerWidth;
});
coarsePointer.addEventListener('change', updateGestureHelp);
updateGestureHelp();
updateRendererSize();

function animate(timeMs) {
  requestAnimationFrame(animate);
  roomVisuals.forEach(visual => {
    const pulse = sensorPulseAmount(visual.sensorFaulted, reducedMotion.matches, timeMs);
    visual.sensor.scale.setScalar(1 + pulse * 0.16);
    visual.sensor.material.emissiveIntensity = 1 + pulse * 1.25;
  });
  controls.update();
  renderer.render(scene, camera);
}
requestAnimationFrame(animate);
refresh().catch(error => {
  document.querySelector('#floorLoading').textContent = t('floorListUnavailable');
  const transportStatus = document.querySelector('#transportStatus');
  transportStatus.textContent = t('transportStatusUnavailable');
  transportStatus.classList.add('offline');
  const loadError = document.querySelector('#loadError');
  loadError.textContent = t('unableToLoadBuildingState', { error: error.message });
  loadError.hidden = false;
});
