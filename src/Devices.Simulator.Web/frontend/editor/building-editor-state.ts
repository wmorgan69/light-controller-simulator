import type {
  BuildingDesign,
  BuildingEditorStateDto,
  BuildingFloor,
  BuildingRoom,
  SaveBuildingEditorDto
} from './BuildingEditor.types.js';
import { t } from '../shared/localization.en.js';
import { responseDetail } from '../shared/mutation-access.js';
import { materializeLegacyAccess } from '../shared/building-editor-access.js';

type EditorState = BuildingEditorStateDto;
type Fetcher = (url: string, options?: RequestInit) => Promise<Response>;

class EditorRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'EditorRequestError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isBuildingDesign(value: unknown): value is BuildingDesign {
  if (!isRecord(value) || !Number.isSafeInteger(value.revision) ||
      typeof value.width !== 'number' || typeof value.depth !== 'number' || !Array.isArray(value.floors)) return false;
  return value.floors.every(floor => {
    if (!isRecord(floor) || typeof floor.id !== 'string' || typeof floor.number !== 'number' ||
        typeof floor.controllerId !== 'string' || typeof floor.controllerX !== 'number' ||
        typeof floor.controllerZ !== 'number' || !Array.isArray(floor.rooms)) return false;
    const validArea = (area: unknown): boolean => isRecord(area) && typeof area.id === 'string' &&
      typeof area.x === 'number' && typeof area.z === 'number' &&
      typeof area.width === 'number' && typeof area.depth === 'number';
    if (floor.walkways != null && (!Array.isArray(floor.walkways) || !floor.walkways.every(validArea))) return false;
    if (floor.stairs != null && (!Array.isArray(floor.stairs) || !floor.stairs.every(area =>
      validArea(area) && isRecord(area) && (area.direction === 'east' || area.direction === 'west')))) return false;
    return floor.rooms.every(room => {
      if (!isRecord(room) || typeof room.id !== 'string' || typeof room.name !== 'string' ||
          typeof room.x !== 'number' || typeof room.z !== 'number' || typeof room.width !== 'number' ||
          typeof room.depth !== 'number' || !isRecord(room.sensor) || !Array.isArray(room.doors) ||
          !Array.isArray(room.lights)) return false;
      const validDevice = (device: unknown): boolean => isRecord(device) &&
        typeof device.id === 'string' && typeof device.x === 'number' && typeof device.z === 'number';
      return validDevice(room.sensor) &&
        (room.sensor.controllerId === null || typeof room.sensor.controllerId === 'string') &&
        room.doors.every(validDevice) &&
        room.lights.every(device => validDevice(device) && isRecord(device) &&
          (device.controllerId === null || typeof device.controllerId === 'string'));
    });
  });
}

function isEditorState(value: unknown): value is EditorState {
  return isRecord(value) && isBuildingDesign(value.design) &&
    (value.activeDesign === null || isBuildingDesign(value.activeDesign)) &&
    Number.isSafeInteger(value.editRevision) && typeof value.activationStatus === 'string' &&
    (value.cleanup === null || (Array.isArray(value.cleanup) && value.cleanup.every(entry =>
      isRecord(entry) && typeof entry.status === 'string')));
}

function parseEditorState(value: unknown): EditorState {
  if (!isEditorState(value)) throw new Error(t('editorInvalidState'));
  return value;
}

const copy = <T>(value: T): T => structuredClone(value);
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const sameDesign = (a: BuildingDesign | null, b: BuildingDesign | null): boolean => a && b
  ? same({ ...a, revision: 0 }, { ...b, revision: 0 })
  : same(a, b);
export const newId = (prefix: string): string => `${prefix}-${crypto.randomUUID()}`;
export const snap = (value: number): number => Math.round(value * 2) / 2;

export function validAccessArea(item: { x: number; z: number; width: number; depth: number }, design: BuildingDesign): boolean {
  return [item.x, item.z, item.width, item.depth].every(Number.isFinite) &&
    item.width > 0 && item.depth > 0 && item.x >= -4 && item.z >= -4 &&
    item.x + item.width <= design.width + 4 && item.z + item.depth <= design.depth + 4;
}

export function newFloor(number: number): BuildingFloor {
  return { id: newId('floor'), number, controllerId: newId('controller'), controllerX: 0, controllerZ: 0, rooms: [], walkways: [], stairs: [] };
}

export function newRoom(x: number, z: number, width: number, depth: number, name: string, controllerId: string): BuildingRoom {
  return {
    id: newId('room'), name, x, z, width, depth,
    sensor: { id: newId('sensor'), x, z, controllerId },
    doors: [], lights: []
  };
}

function designIds(design: BuildingDesign): Set<string> {
  const ids = new Set<string>();
  for (const floor of design.floors) {
    ids.add(floor.id); ids.add(floor.controllerId);
    for (const item of [...floor.walkways ?? [], ...floor.stairs ?? []]) ids.add(item.id);
    for (const room of floor.rooms) {
      ids.add(room.id); ids.add(room.sensor.id);
      for (const device of [...room.doors, ...room.lights]) ids.add(device.id);
    }
  }
  return ids;
}

function replaceRetiredIds(design: BuildingDesign, retired: Set<string>): void {
  const replacements = new Map<string, string>();
  const replace = (id: string, prefix: string): string => {
    if (!retired.has(id)) return id;
    const existing = replacements.get(id);
    if (existing) return existing;
    const replacement = newId(prefix);
    replacements.set(id, replacement);
    return replacement;
  };
  for (const floor of design.floors) {
    floor.id = replace(floor.id, 'floor');
    floor.controllerId = replace(floor.controllerId, 'controller');
    for (const item of floor.walkways ?? []) item.id = replace(item.id, 'walkway');
    for (const item of floor.stairs ?? []) item.id = replace(item.id, 'stair');
    for (const room of floor.rooms) {
      room.id = replace(room.id, 'room');
      room.sensor.id = replace(room.sensor.id, 'sensor');
      for (const door of room.doors) door.id = replace(door.id, 'door');
      for (const light of room.lights) light.id = replace(light.id, 'light');
    }
  }
  for (const floor of design.floors) for (const room of floor.rooms)
    for (const device of [room.sensor, ...room.lights]) {
      if (device.controllerId === null) continue;
      const replacement = replacements.get(device.controllerId);
      if (replacement !== undefined) device.controllerId = replacement;
    }
}

export function validateDesign(design: BuildingDesign): string | null {
  const grid = (n: number): boolean => Number.isFinite(n) && n * 2 === Math.round(n * 2);
  const size = (n: number): boolean => grid(n) && n >= 2 && n <= 100;
  if (!size(design.width) || !size(design.depth) || design.floors.length < 1 || design.floors.length > 10)
    return t('editorInvalidBuilding');
  const point = (p: { x: number; z: number }, x: number, z: number, right: number, bottom: number): boolean =>
    grid(p.x) && grid(p.z) && p.x >= x && p.x <= right && p.z >= z && p.z <= bottom;
  for (const floor of design.floors) {
    if (!point({ x: floor.controllerX, z: floor.controllerZ }, 0, 0, design.width, design.depth))
      return t('editorInvalidPoint', { item: t('editorController') });
    if ((floor.walkways?.length ?? 0) > 256)
      return t('editorAccessLimit', { item: t('editorWalkway'), limit: 256 });
    if ((floor.stairs?.length ?? 0) > 32)
      return t('editorAccessLimit', { item: t('editorStairs'), limit: 32 });
    if ((floor.walkways ?? []).some(item => !validAccessArea(item, design)))
      return t('editorInvalidAccess', { item: t('editorWalkway') });
    if ((floor.stairs?.length ?? 0) > 0 && floor.number === design.floors.length)
      return t('editorStairsTopFloor');
    if ((floor.stairs ?? []).some(item => !validAccessArea(item, design) ||
      (item.direction !== 'east' && item.direction !== 'west')))
      return t('editorInvalidAccess', { item: t('editorStairs') });
    for (const [i, room] of floor.rooms.entries()) {
      const { x, z, width, depth } = room;
      if (typeof room.name !== 'string' || !room.name.trim())
        return t('editorInvalidRoom', { room: room.id });
      if (room.name.length > 256) return t('editorRoomNameTooLong');
      if (!grid(x) || !grid(z) || !grid(width) || !grid(depth) ||
          x < 0 || z < 0 || width < 1 || depth < 1 || x + width > design.width || z + depth > design.depth ||
          floor.rooms.slice(0, i).some(r => x < r.x + r.width && x + width > r.x && z < r.z + r.depth && z + depth > r.z))
        return t('editorInvalidRoom', { room: room.name || room.id });
      const check = (
        device: { x: number; z: number; controllerId?: string | null },
        label: string,
        boundary: boolean,
        wired: boolean
      ): string | null => {
        if (!point(device, x, z, x + width, z + depth)) return t('editorInvalidPoint', { item: label });
        if (boundary && device.x !== x && device.x !== x + width && device.z !== z && device.z !== z + depth)
          return t('editorInvalidDoor', { item: label });
        if (wired && device.controllerId !== floor.controllerId) return t('editorInvalidConnection', { item: label });
        return null;
      };
      let error = check(room.sensor, t('editorSensor', { room: room.name }), false, true);
      if (error) return error;
      for (const [index, door] of room.doors.entries()) {
        error = check(door, t('editorDoor', { number: index + 1, room: room.name }), true, false);
        if (error) return error;
      }
      for (const [index, light] of room.lights.entries()) {
        error = check(light, t('editorLight', { number: index + 1, room: room.name }), false, true);
        if (error) return error;
      }
    }
  }
  return null;
}

export class EditorSession {
  design: BuildingDesign | null = null;
  saved: BuildingDesign | null = null;
  undoStack: BuildingDesign[] = [];
  redoStack: BuildingDesign[] = [];
  conflict = false;
  retiredIds = new Set<string>();
  statusVersion = 0;
  editRevision = 0;
  activationStatus = '';
  activeDesign: BuildingDesign | null = null;
  cleanup: EditorState['cleanup'] = null;
  saving = false;
  error: string | null = null;
  statusError: string | null = null;
  private statusPromise: Promise<void> | null = null;
  private readonly fetcher: Fetcher;
  private readonly changed: () => void;

  constructor(fetcher: Fetcher = fetch, changed: () => void = () => {}) {
    this.fetcher = (...args) => fetcher(...args);
    this.changed = changed;
    this.design = null;
    this.saved = null;
    this.undoStack = [];
    this.redoStack = [];
    this.conflict = false;
    this.retiredIds = new Set<string>();
    this.statusVersion = 0;
  }

  async request(path: '' | '/save' | '/retry' | '/retry-cleanup' | '/default-design', method = 'GET', body?: SaveBuildingEditorDto): Promise<unknown> {
    const response = await this.fetcher(`/api/building-editor${path}`, {
      method, credentials: 'same-origin',
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    });
    if (!response.ok) {
      throw new EditorRequestError(await responseDetail(response), response.status);
    }
    if (response.status === 204) return null;
    const text = await response.text();
    const result: unknown = text ? JSON.parse(text) : null;
    return result;
  }

  async open(): Promise<void> {
    const result = parseEditorState(await this.request(''));
    this.editRevision = this.requireRevision(result);
    this.saved = copy(result.design);
    this.saved.floors.sort((a, b) => a.number - b.number);
    materializeLegacyAccess(this.saved, newId);
    this.design = copy(this.saved);
    this.activationStatus = result.activationStatus;
    this.activeDesign = copy(result.activeDesign);
    this.cleanup = copy(result.cleanup);
    this.changed();
  }

  get dirty(): boolean { return !sameDesign(this.design, this.saved); }

  async defaultDesign(): Promise<BuildingDesign> {
    const result = await this.request('/default-design');
    if (!isBuildingDesign(result) || validateDesign(result)) throw new Error(t('editorInvalidState'));
    const template = copy(result);
    template.floors.sort((a, b) => a.number - b.number);
    materializeLegacyAccess(template, newId);
    replaceRetiredIds(template, designIds(template));
    return template;
  }

  requireRevision(result: unknown): number {
    if (!isRecord(result) || typeof result.editRevision !== 'number' ||
        !Number.isSafeInteger(result.editRevision) || result.editRevision < 0)
      throw new Error(t('editorProtocolError'));
    return result.editRevision;
  }

  edit(change: (design: BuildingDesign) => void): void {
    if (!this.design || this.conflict || this.saving) return;
    const next = copy(this.design);
    change(next);
    if (same(next, this.design)) return;
    this.undoStack.push(copy(this.design));
    this.redoStack = [];
    this.design = next;
    this.changed();
  }

  history(from: BuildingDesign[], to: BuildingDesign[]): void {
    if (!this.design || this.conflict || this.saving || !from.length) return;
    if (!this.saved) return;
    to.push(copy(this.design));
    const previous = from.pop();
    if (!previous) return;
    this.design = previous;
    replaceRetiredIds(this.design, this.retiredIds);
    this.design.revision = this.saved.revision;
    this.changed();
  }

  async useCurrent(): Promise<void> {
    const result = parseEditorState(await this.request(''));
    const revision = this.requireRevision(result);
    this.saved = copy(result.design);
    this.saved.floors.sort((a, b) => a.number - b.number);
    materializeLegacyAccess(this.saved, newId);
    this.design = copy(this.saved);
    this.activationStatus = result.activationStatus;
    this.activeDesign = copy(result.activeDesign);
    this.cleanup = copy(result.cleanup);
    this.editRevision = revision;
    this.undoStack = [];
    this.redoStack = [];
    this.conflict = false;
    this.error = null;
    this.changed();
  }

  async save(): Promise<EditorState> {
    this.saving = true;
    try {
      if (!this.design) throw new Error(t('editorProtocolError'));
      const validation = validateDesign(this.design);
      if (validation) throw new Error(validation);
      if (this.conflict) throw new Error(t('editorConflict'));
      let result: EditorState;
      try {
        result = parseEditorState(await this.request('/save', 'POST', { expectedRevision: this.editRevision, design: copy(this.design) }));
      } catch (error) {
        if (error instanceof EditorRequestError && error.status === 409) { this.conflict = true; this.changed(); }
        throw error;
      }
      this.editRevision = this.requireRevision(result);
      const currentIds = designIds(result.design);
      if (!this.saved) throw new Error(t('editorProtocolError'));
      for (const id of designIds(this.saved)) if (!currentIds.has(id)) this.retiredIds.add(id);
      this.design = copy(result.design);
      this.saved = copy(result.design);
      this.statusVersion++;
      this.activationStatus = result.activationStatus;
      this.activeDesign = copy(result.activeDesign);
      this.cleanup = copy(result.cleanup);
      this.error = null;
      this.changed();
      return result;
    } finally { this.saving = false; }
  }

  async retryWork(path: '/retry' | '/retry-cleanup'): Promise<void> {
    if (this.statusPromise) await this.statusPromise;
    await this.request(path, 'POST');
    this.statusVersion++;
    await this.refreshStatus();
  }

  async refreshStatus(): Promise<void> {
    if (this.statusPromise) return this.statusPromise;
    const version = this.statusVersion;
    this.statusPromise = (async () => {
      try {
        const state = parseEditorState(await this.request(''));
        if (version !== this.statusVersion) return;
        this.activationStatus = state.activationStatus;
        this.activeDesign = copy(state.activeDesign);
        this.cleanup = copy(state.cleanup);
        this.statusError = null;
      } catch (error) {
        if (version === this.statusVersion) this.statusError = error instanceof Error ? error.message : String(error);
      } finally { this.changed(); }
    })();
    try { await this.statusPromise; }
    finally { this.statusPromise = null; }
  }

}
