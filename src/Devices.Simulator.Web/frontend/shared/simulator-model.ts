import { t } from './localization.en.js';

export type ControllerStatus = 'Healthy' | 'Faulted' | 'Offline';
export type FaultScope = 'sensor' | 'light' | 'controller';

export interface LightStripDto {
  id: string;
  roomId: string;
  isOn: boolean;
  isFaulted: boolean;
}

export interface RoomDto {
  id: string;
  name: string;
  controllerId: string;
  sensorTriggered: boolean;
  presence: boolean;
  lightStrips: LightStripDto[];
  sensorId?: string | null;
}

export interface ControllerFaultDto {
  id: string;
  scope: string;
  targetId: string;
  description: string;
}

export interface ControllerDto {
  id: string;
  floor: number;
  status: ControllerStatus;
  lastSeen: string;
  rooms: RoomDto[];
  faults: ControllerFaultDto[];
  revision: number;
}

export interface SensorDesignDto {
  id: string;
  x: number;
  z: number;
  controllerId: string | null;
}

export interface LightDesignDto {
  id: string;
  x: number;
  z: number;
  controllerId: string | null;
}

export interface DoorDesignDto {
  id: string;
  x: number;
  z: number;
}

export interface WalkwayDesignDto {
  id: string;
  x: number;
  z: number;
  width: number;
  depth: number;
}

export interface StairDesignDto extends WalkwayDesignDto {
  direction: 'east' | 'west';
}

export interface RoomDesignDto {
  id: string;
  name: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  sensor: SensorDesignDto;
  doors: DoorDesignDto[];
  lights: LightDesignDto[];
}

export interface FloorDesignDto {
  id: string;
  number: number;
  controllerId: string;
  controllerX: number;
  controllerZ: number;
  rooms: RoomDesignDto[];
  walkways?: WalkwayDesignDto[] | null;
  stairs?: StairDesignDto[] | null;
}

export interface BuildingDesignDto {
  revision: number;
  width: number;
  depth: number;
  floors: FloorDesignDto[];
}

export interface BuildingViewDto {
  design: BuildingDesignDto | null;
  controllers: ControllerDto[];
}

export interface DesignStatusDto {
  savedRevision: number;
  runningRevision: number;
  pendingCleanup: number;
  failedCleanup: number;
  completedCleanup: number;
  activationStatus: 'active' | 'failed' | 'pending' | string;
}

export interface RoomSelection {
  type: 'room';
  roomId: string;
  controllerId: string;
  floor: number;
}

export interface FloorSelection {
  type: 'floor';
  controllerId: string;
  floor: number;
}

export interface ControllerSelection {
  type: 'controller';
  controllerId: string;
  roomId?: string | undefined;
  floor: number;
}

export type LightSelection = Omit<RoomSelection, 'type'> & {
  type: 'light';
  targetId: string;
};

export type SensorSelection = Omit<RoomSelection, 'type'> & {
  type: 'sensor';
  targetId?: string | null | undefined;
};

export type SceneSelection =
  | RoomSelection
  | FloorSelection
  | ControllerSelection
  | LightSelection
  | SensorSelection;

export interface RoomTargetOption {
  id: string;
  label: string;
}

export interface FaultTargetOption {
  id: string;
  label: string;
}

export interface FloorStatus {
  occupied: number;
  total: number;
}

export interface FoundRoom {
  controller: ControllerDto;
  room: RoomDto;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function isArrayOf<T>(value: unknown, isItem: (item: unknown) => item is T): value is T[] {
  return isUnknownArray(value) && value.every(isItem);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isSceneSelection(value: unknown): value is SceneSelection {
  if (!isRecord(value) || !isString(value.type) || !isString(value.controllerId) ||
      !isNumber(value.floor)) return false;
  switch (value.type) {
    case 'floor':
      return true;
    case 'controller':
      return value.roomId === undefined || isString(value.roomId);
    case 'room':
      return isString(value.roomId);
    case 'light':
      return isString(value.roomId) && isString(value.targetId);
    case 'sensor':
      return isString(value.roomId) &&
        (value.targetId === undefined || value.targetId === null || isString(value.targetId));
    default:
      return false;
  }
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isLight(value: unknown): value is LightStripDto {
  return isRecord(value) && isString(value.id) && isString(value.roomId) &&
    typeof value.isOn === 'boolean' && typeof value.isFaulted === 'boolean';
}

function isRoom(value: unknown): value is RoomDto {
  return isRecord(value) && isString(value.id) && isString(value.name) &&
    isString(value.controllerId) && typeof value.sensorTriggered === 'boolean' &&
    typeof value.presence === 'boolean' &&
    (value.sensorId === undefined || value.sensorId === null || isString(value.sensorId)) &&
    isArrayOf(value.lightStrips, isLight);
}

function isFault(value: unknown): value is ControllerFaultDto {
  return isRecord(value) && isString(value.id) && isString(value.scope) &&
    isString(value.targetId) && isString(value.description);
}

export function isController(value: unknown): value is ControllerDto {
  return isRecord(value) && isString(value.id) && isNumber(value.floor) &&
    (value.status === 'Healthy' || value.status === 'Faulted' || value.status === 'Offline') &&
    isString(value.lastSeen) && Number.isInteger(value.revision) &&
    isArrayOf(value.rooms, isRoom) && isArrayOf(value.faults, isFault);
}

function isSensorDesign(value: unknown): value is SensorDesignDto {
  return isRecord(value) && isString(value.id) && isNumber(value.x) && isNumber(value.z) &&
    (value.controllerId === null || isString(value.controllerId));
}

function isLightDesign(value: unknown): value is LightDesignDto {
  return isRecord(value) && isString(value.id) && isNumber(value.x) && isNumber(value.z) &&
    (value.controllerId === null || isString(value.controllerId));
}

function isDoorDesign(value: unknown): value is DoorDesignDto {
  return isRecord(value) && isString(value.id) && isNumber(value.x) && isNumber(value.z);
}

function isRoomDesign(value: unknown): value is RoomDesignDto {
  return isRecord(value) && isString(value.id) && isString(value.name) &&
    isNumber(value.x) && isNumber(value.z) && isNumber(value.width) && isNumber(value.depth) &&
    isSensorDesign(value.sensor) && isArrayOf(value.doors, isDoorDesign) &&
    isArrayOf(value.lights, isLightDesign);
}

function isFloorDesign(value: unknown): value is FloorDesignDto {
  return isRecord(value) && isString(value.id) && Number.isInteger(value.number) &&
    isString(value.controllerId) && isNumber(value.controllerX) && isNumber(value.controllerZ) &&
    isArrayOf(value.rooms, isRoomDesign) &&
    (value.walkways == null || isArrayOf(value.walkways, isWalkwayDesign)) &&
    (value.stairs == null || isArrayOf(value.stairs, isStairDesign));
}

function isWalkwayDesign(value: unknown): value is WalkwayDesignDto {
  return isRecord(value) && isString(value.id) && isNumber(value.x) && isNumber(value.z) &&
    isNumber(value.width) && isNumber(value.depth);
}

function isStairDesign(value: unknown): value is StairDesignDto {
  return isRecord(value) && isWalkwayDesign(value) && (value.direction === 'east' || value.direction === 'west');
}

export function isBuildingDesign(value: unknown): value is BuildingDesignDto {
  return isRecord(value) && Number.isInteger(value.revision) && isNumber(value.width) &&
    isNumber(value.depth) && isArrayOf(value.floors, isFloorDesign);
}

export function isBuildingView(value: unknown): value is BuildingViewDto {
  if (!isRecord(value) || !isArrayOf(value.controllers, isController)) return false;
  if (value.design !== null && !isBuildingDesign(value.design)) return false;
  return new Set(value.controllers.map(controller => controller.id)).size === value.controllers.length;
}

export function isDesignStatus(value: unknown): value is DesignStatusDto {
  return isRecord(value) && Number.isInteger(value.savedRevision) &&
    Number.isInteger(value.runningRevision) && Number.isInteger(value.pendingCleanup) &&
    Number.isInteger(value.failedCleanup) && Number.isInteger(value.completedCleanup) &&
    isString(value.activationStatus);
}

export function roomSensorId(controller: ControllerDto, room: RoomDto): string {
  return room.sensorId ?? `sensor-floor-${controller.floor}-${room.id.slice(`floor-${controller.floor}-`.length)}`;
}

export function findRoom(controllers: ControllerDto[], roomId: string | null): FoundRoom | null {
  if (roomId === null) return null;
  for (const controller of controllers) {
    const room = controller.rooms.find(candidate => candidate.id === roomId);
    if (room) return { controller, room };
  }
  return null;
}

export function faultForRoom(controller: ControllerDto, room: RoomDto): ControllerFaultDto | undefined {
  const sensorId = roomSensorId(controller, room);
  return controller.faults.find(fault => fault.scope === 'sensor' && fault.targetId === sensorId);
}

export function accessibleRoomOptions(controllers: ControllerDto[]): RoomTargetOption[] {
  return controllers.flatMap(controller => controller.rooms.map(room => ({
    id: room.id,
    label: t('roomTarget', { controller: controller.id, room: room.name })
  })));
}

export function accessibleFaultOptions(controllers: ControllerDto[], scope: string): FaultTargetOption[] {
  if (scope === 'sensor') {
    return controllers.flatMap(controller => controller.rooms.map(room => ({
      id: roomSensorId(controller, room),
      label: t('sensorTarget', { floor: controller.floor, room: room.name })
    })));
  }
  if (scope === 'light') {
    return controllers.flatMap(controller => controller.rooms.flatMap(room =>
      room.lightStrips.map((strip, index) => ({
        id: strip.id,
        label: t('lightTarget', { floor: controller.floor, room: room.name, strip: index + 1 })
      }))));
  }
  return controllers.map(controller => ({
    id: controller.id,
    label: t('controllerTarget', { floor: controller.floor })
  }));
}

export function controllerForTarget(
  controllers: ControllerDto[],
  scope: string,
  targetId: string
): ControllerDto | undefined {
  return controllers.find(controller => scope === 'controller'
    ? controller.id === targetId
    : scope === 'sensor'
      ? controller.rooms.some(room => roomSensorId(controller, room) === targetId)
      : controller.rooms.some(room => room.lightStrips.some(strip => strip.id === targetId)));
}

export function selectedRoomForFloor(controller: ControllerDto | undefined | null): RoomDto | null {
  return controller?.rooms.find(room => room.id.endsWith('-main')) ?? controller?.rooms[0] ?? null;
}

export function floorStatus(controller: ControllerDto): FloorStatus {
  return {
    occupied: controller.rooms.filter(room => room.presence).length,
    total: controller.rooms.length
  };
}

export function isMutationState(value: unknown): value is ControllerDto | ControllerDto[] {
  if (!isUnknownArray(value)) return isController(value);
  if (!isArrayOf(value, isController) || value.length === 0) return false;
  return new Set(value.map(controller => controller.id)).size === value.length;
}

export function applyMutationState(
  current: ControllerDto[],
  value: ControllerDto | ControllerDto[]
): ControllerDto[] | null {
  if (Array.isArray(value)) {
    if (current.length && (current.length !== value.length ||
        current.some(controller => !value.some(item => item.id === controller.id)))) return null;
    const currentById = new Map(current.map(controller => [controller.id, controller]));
    return value.map(controller => {
      const existing = currentById.get(controller.id);
      return existing === undefined || controller.revision >= existing.revision ? controller : existing;
    });
  }
  const index = current.findIndex(controller => controller.id === value.id);
  const existing = current[index];
  if (existing === undefined || value.revision < existing.revision) return null;
  return current.map((controller, position) => position === index ? value : controller);
}

export function refreshDisposition(
  sequence: number,
  lastApplied: number,
  minimumSequence: number
): 'outdated' | 'superseded' | 'apply' {
  if (sequence < lastApplied) return 'outdated';
  if (sequence < minimumSequence) return 'superseded';
  return 'apply';
}

export function refreshFailureDisposition(
  sequence: number,
  latestSequence: number,
  lastApplied: number,
  minimumSequence: number
): 'outdated' | 'superseded' | 'apply' {
  if (sequence !== latestSequence || sequence < lastApplied) return 'outdated';
  if (sequence < minimumSequence) return 'superseded';
  return 'apply';
}

export function selectionFromUserData(userData: unknown): SceneSelection | undefined {
  if (!isRecord(userData) || !isSceneSelection(userData.selection)) return undefined;
  return userData.selection;
}

export function selectionForPointerUp(
  button: number,
  moved: number,
  hit: unknown
): SceneSelection | null | undefined {
  if (button !== 0 || moved >= 5) return undefined;
  if (!isRecord(hit) || !isRecord(hit.userData)) return null;
  return selectionFromUserData(hit.userData) ?? null;
}

export async function readTransportStatus(response: Response | null): Promise<{ mqttConnected: boolean } | null> {
  if (!response?.ok) return null;
  try {
    const status: unknown = await response.json();
    return isRecord(status) && typeof status.mqttConnected === 'boolean'
      ? { mqttConnected: status.mqttConnected }
      : null;
  } catch {
    return null;
  }
}
