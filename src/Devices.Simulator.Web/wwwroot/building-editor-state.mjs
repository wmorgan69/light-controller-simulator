import { t } from './localization.en.mjs?v=6';
import { responseDetail } from './mutation-access.mjs?v=local-edits-6';

const copy = value => structuredClone(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sameDesign = (a, b) => a && b
  ? same({ ...a, revision: 0 }, { ...b, revision: 0 })
  : same(a, b);
export const newId = prefix => `${prefix}-${crypto.randomUUID()}`;
export const snap = value => Math.round(value * 2) / 2;

export function newFloor(number) {
  return { id: newId('floor'), number, controllerId: newId('controller'), controllerX: 0, controllerZ: 0, rooms: [] };
}

export function newRoom(x, z, width, depth, name, controllerId) {
  return {
    id: newId('room'), name, x, z, width, depth,
    sensor: { id: newId('sensor'), x, z, controllerId },
    doors: [], lights: []
  };
}

function designIds(design) {
  const ids = new Set();
  for (const floor of design.floors) {
    ids.add(floor.id); ids.add(floor.controllerId);
    for (const room of floor.rooms) {
      ids.add(room.id); ids.add(room.sensor.id);
      for (const device of [...room.doors, ...room.lights]) ids.add(device.id);
    }
  }
  return ids;
}

function replaceRetiredIds(design, retired) {
  const replacements = new Map();
  const replace = (id, prefix) => {
    if (!retired.has(id)) return id;
    if (!replacements.has(id)) replacements.set(id, newId(prefix));
    return replacements.get(id);
  };
  for (const floor of design.floors) {
    floor.id = replace(floor.id, 'floor');
    floor.controllerId = replace(floor.controllerId, 'controller');
    for (const room of floor.rooms) {
      room.id = replace(room.id, 'room');
      room.sensor.id = replace(room.sensor.id, 'sensor');
      for (const door of room.doors) door.id = replace(door.id, 'door');
      for (const light of room.lights) light.id = replace(light.id, 'light');
    }
  }
  for (const floor of design.floors) for (const room of floor.rooms)
    for (const device of [room.sensor, ...room.lights])
      if (replacements.has(device.controllerId)) device.controllerId = replacements.get(device.controllerId);
}

export function validateDesign(design) {
  const grid = n => Number.isFinite(n) && n * 2 === Math.round(n * 2);
  const size = n => grid(n) && n >= 2 && n <= 100;
  if (!size(design.width) || !size(design.depth) || design.floors.length < 1 || design.floors.length > 10)
    return t('editorInvalidBuilding');
  const point = (p, x, z, right, bottom) =>
    grid(p.x) && grid(p.z) && p.x >= x && p.x <= right && p.z >= z && p.z <= bottom;
  for (const floor of design.floors) {
    if (!point({ x: floor.controllerX, z: floor.controllerZ }, 0, 0, design.width, design.depth))
      return t('editorInvalidPoint', { item: t('editorController') });
    for (const [i, room] of floor.rooms.entries()) {
      const { x, z, width, depth } = room;
      if (typeof room.name !== 'string' || !room.name.trim())
        return t('editorInvalidRoom', { room: room.id });
      if (room.name.length > 256) return t('editorRoomNameTooLong');
      if (!grid(x) || !grid(z) || !grid(width) || !grid(depth) ||
          x < 0 || z < 0 || width < 1 || depth < 1 || x + width > design.width || z + depth > design.depth ||
          floor.rooms.slice(0, i).some(r => x < r.x + r.width && x + width > r.x && z < r.z + r.depth && z + depth > r.z))
        return t('editorInvalidRoom', { room: room.name || room.id });
      const check = (device, label, boundary, wired) => {
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
  constructor(fetcher = fetch, changed = () => {}) {
    this.fetcher = (...args) => fetcher(...args);
    this.changed = changed;
    this.design = null;
    this.saved = null;
    this.undoStack = [];
    this.redoStack = [];
    this.conflict = false;
    this.retiredIds = new Set();
    this.statusVersion = 0;
  }

  async request(path, method = 'GET', body) {
    const response = await this.fetcher(`/api/building-editor${path}`, {
      method, credentials: 'same-origin',
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    });
    if (!response.ok) {
      const error = new Error(await responseDetail(response));
      error.status = response.status;
      throw error;
    }
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  async open() {
    const result = await this.request('');
    this.editRevision = this.requireRevision(result);
    this.saved = copy(result.design);
    this.design = copy(result.design);
    this.activationStatus = result.activationStatus;
    this.activeDesign = copy(result.activeDesign);
    this.cleanup = copy(result.cleanup);
    this.changed();
  }

  get dirty() { return !sameDesign(this.design, this.saved); }

  requireRevision(result) {
    if (!Number.isSafeInteger(result?.editRevision) || result.editRevision < 0)
      throw new Error(t('editorProtocolError'));
    return result.editRevision;
  }

  edit(change) {
    if (!this.design || this.conflict || this.saving) return;
    const next = copy(this.design);
    change(next);
    if (same(next, this.design)) return;
    this.undoStack.push(copy(this.design));
    this.redoStack = [];
    this.design = next;
    this.changed();
  }

  history(from, to) {
    if (!this.design || this.conflict || this.saving || !from.length) return;
    to.push(copy(this.design));
    this.design = from.pop();
    replaceRetiredIds(this.design, this.retiredIds);
    this.design.revision = this.saved.revision;
    this.changed();
  }

  async useCurrent() {
    const result = await this.request('');
    const revision = this.requireRevision(result);
    this.saved = copy(result.design);
    this.design = copy(result.design);
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

  async save() {
    this.saving = true;
    try {
      const validation = validateDesign(this.design);
      if (validation) throw new Error(validation);
      if (this.conflict) throw new Error(t('editorConflict'));
      let result;
      try {
        result = await this.request('/save', 'POST', { expectedRevision: this.editRevision, design: copy(this.design) });
      } catch (error) {
        if (error.status === 409) { this.conflict = true; this.changed(); }
        throw error;
      }
      this.editRevision = this.requireRevision(result);
      const currentIds = designIds(result.design);
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

  async retryWork(path) {
    if (this.statusPromise) await this.statusPromise;
    await this.request(path, 'POST');
    this.statusVersion++;
    await this.refreshStatus();
  }

  async refreshStatus() {
    if (this.statusPromise) return this.statusPromise;
    const version = this.statusVersion;
    this.statusPromise = (async () => {
      try {
        const state = await this.request('');
        if (version !== this.statusVersion) return;
        this.activationStatus = state.activationStatus;
        this.activeDesign = copy(state.activeDesign);
        this.cleanup = copy(state.cleanup);
        this.statusError = null;
      } catch (error) {
        if (version === this.statusVersion) this.statusError = error.message;
      } finally { this.changed(); }
    })();
    try { await this.statusPromise; }
    finally { this.statusPromise = null; }
  }

}
