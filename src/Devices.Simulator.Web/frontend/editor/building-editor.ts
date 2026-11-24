import type {
  BuildingDesign,
  BuildingFloor,
  BuildingRoom,
  EditorFormName,
  EditorNumericConstraints,
  EditorPendingProjection,
  EditorRecoveryContext,
  EditorSelection,
  EditorTool,
  EditorValidationIssue,
  MutationAccess,
  PendingEditorForm
} from './BuildingEditor.types.js';
import type {
  DoorDesignDto,
  LightDesignDto,
  SensorDesignDto
} from '../shared/simulator-model.js';
import { t } from '../shared/localization.en.js';
import { EditorSession, newFloor, newId, newRoom, snap, validAccessArea, validateDesign } from './building-editor-state.js';

const svgNs = 'http://www.w3.org/2000/svg';
const numberInputPattern = '-?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)(?:[eE](?:\\+|-)?[0-9]+)?';
const numberInputSyntax = new RegExp(`^(?:${numberInputPattern})$`);

type FormField = {
  type: string;
  value: string;
  name?: string;
  checked?: boolean;
  dispatchEvent?: (event: Event) => boolean;
};
type ValidationIssueContext = Pick<EditorValidationIssue, 'floor' | 'selection'> &
  Partial<Pick<EditorValidationIssue, 'error' | 'field' | 'item'>>;
type FocusableEditorElement = Element & { focus(options?: FocusOptions): void; dataset: DOMStringMap };
type FormSnapshot = {
  form: EditorFormName | undefined;
  fields: Array<{ name?: string; type: string; value: string; checked?: boolean }>;
};
type FormGuard = {
  track(form: HTMLFormElement): void;
  hasChanges(): boolean;
  capture(): FormSnapshot[];
  pending(): FormSnapshot[];
  restore(snapshots: FormSnapshot[]): void;
  confirm(except?: HTMLFormElement | null): boolean;
};

function isFormField(field: Element): field is Element & FormField {
  return 'type' in field && typeof field.type === 'string' &&
    'value' in field && typeof field.value === 'string';
}

function isCheckableField(field: FormField): field is FormField & { checked: boolean } {
  return 'checked' in field && typeof field.checked === 'boolean';
}

export function createFormGuard(
  content: HTMLElement,
  confirmDiscard: () => boolean,
  onChange: () => void = () => {}
): FormGuard {
  const initial = new WeakMap<HTMLFormElement, Array<string | boolean>>();
  const fields = (form: HTMLFormElement): FormField[] =>
    [...form.querySelectorAll('input, select, textarea')].filter(isFormField);
  const value = (field: FormField): string | boolean => isCheckableField(field) &&
    (field.type === 'checkbox' || field.type === 'radio') ? field.checked : field.value;
  const formId = (form: HTMLFormElement): EditorFormName | undefined => {
    const formName = form.dataset.form;
    return formName === 'building' || formName === 'new-room' || formName === 'properties' ? formName : undefined;
  };
  const snapshotForm = (form: HTMLFormElement): FormSnapshot => ({
    form: formId(form),
    fields: fields(form).map(field => ({
      name: field.name,
      type: field.type,
      value: field.value,
      checked: field.checked
    }))
  });
  const changedForms = (except?: HTMLFormElement | null): HTMLFormElement[] => [...content.querySelectorAll('form')].filter(form => {
    const values = initial.get(form);
    return form !== except && values !== undefined && fields(form).some((field, index) => value(field) !== values[index]);
  });
  if (content.addEventListener) {
    content.addEventListener('input', onChange);
    content.addEventListener('change', onChange);
  }
  return {
    track(form: HTMLFormElement) { initial.set(form, fields(form).map(value)); },
    hasChanges() { return changedForms().length > 0; },
    capture() { return changedForms().map(snapshotForm); },
    pending() { return changedForms().map(snapshotForm); },
    restore(snapshots: FormSnapshot[]) {
      let dispatched = false;
      for (const snapshot of snapshots) {
        const form = [...content.querySelectorAll('form')].find(candidate => formId(candidate) === snapshot.form);
        if (!form) continue;
        const currentFields = fields(form);
        for (const saved of snapshot.fields) {
          const field = currentFields.find(candidate => candidate.name === saved.name);
          if (!field) continue;
          if (field.type === 'checkbox' || field.type === 'radio') {
            if (isCheckableField(field)) field.checked = saved.checked ?? false;
          }
          else field.value = saved.value;
          if (field.dispatchEvent && typeof Event !== 'undefined') {
            field.dispatchEvent(new Event('input', { bubbles: true }));
            dispatched = true;
          }
        }
      }
      if (!dispatched) onChange();
    },
    confirm(except?: HTMLFormElement | null) {
      const changed = changedForms(except);
      if (!changed.length) return true;
      if (!confirmDiscard()) return false;
      for (const form of changed) fields(form).forEach((field, index) => {
        const values = initial.get(form) ?? [];
        if (isCheckableField(field) && (field.type === 'checkbox' || field.type === 'radio'))
          field.checked = Boolean(values[index]);
        else field.value = String(values[index]);
        if (field.dispatchEvent && typeof Event !== 'undefined')
          field.dispatchEvent(new Event('input', { bubbles: true }));
      });
      onChange();
      return true;
    }
  };
}

export function locateValidation(design: BuildingDesign): EditorValidationIssue | null {
  const error = validateDesign(design);
  if (!error) return null;
  const pointField = (point: { x: number; z: number }, x: number, z: number, right: number, bottom: number): string =>
    !Number.isFinite(point.x) || point.x < x || point.x > right || point.x * 2 !== Math.round(point.x * 2) ? 'x' :
      !Number.isFinite(point.z) || point.z < z || point.z > bottom || point.z * 2 !== Math.round(point.z * 2) ? 'z' : 'x';
  if (error === t('editorInvalidBuilding')) {
    const validSize = (value: number): boolean => Number.isFinite(value) && value >= 2 && value <= 100 && value * 2 === Math.round(value * 2);
    return { error, field: !validSize(design.width) ? 'width' : !validSize(design.depth) ? 'depth' : 'count' };
  }
  for (const [index, floor] of design.floors.entries()) {
    for (const [kind, items, limit] of [
      ['walkway', floor.walkways ?? [], 256], ['stair', floor.stairs ?? [], 32]
    ] as const) {
      const label = t(kind === 'walkway' ? 'editorWalkway' : 'editorStairs');
      if (items.length > limit && error === t('editorAccessLimit', { item: label, limit }))
        return { error, floor: index, item: label };
    }
    for (const [kind, items] of [['walkway', floor.walkways ?? []], ['stair', floor.stairs ?? []]] as const) {
      const label = t(kind === 'walkway' ? 'editorWalkway' : 'editorStairs');
      if (error !== t('editorInvalidAccess', { item: label }) &&
          !(kind === 'stair' && error === t('editorStairsTopFloor'))) continue;
      const item = items.find(value => !validAccessArea(value, design) ||
        (kind === 'stair' && (floor.number === design.floors.length ||
          ('direction' in value && value.direction !== 'east' && value.direction !== 'west'))));
      if (item) {
        const field = !Number.isFinite(item.x) || item.x < -4 || item.x >= design.width + 4 ? 'x' :
          !Number.isFinite(item.z) || item.z < -4 || item.z >= design.depth + 4 ? 'z' :
          !Number.isFinite(item.width) || item.width <= 0 || item.x + item.width > design.width + 4 ? 'width' :
          !Number.isFinite(item.depth) || item.depth <= 0 || item.z + item.depth > design.depth + 4 ? 'depth' :
          'direction' in item && item.direction !== 'east' && item.direction !== 'west' ? 'direction' : undefined;
        return { error, floor: index, item: label, selection: { kind, id: item.id }, field };
      }
    }
    const floorError = validateDesign({ ...design, floors: [{ ...floor, walkways: [], stairs: [] }] });
    if (!floorError) continue;
    const controller = t('editorController');
    if (floorError === t('editorInvalidPoint', { item: controller }))
      return { error: floorError, floor: index, selection: { kind: 'controller' }, item: controller,
        field: pointField({ x: floor.controllerX, z: floor.controllerZ }, 0, 0, design.width, design.depth) };
    for (const [roomIndex, room] of floor.rooms.entries()) {
      const roomError = validateDesign({ ...design, floors: [{ ...floor, walkways: [], stairs: [], rooms: floor.rooms.slice(0, roomIndex + 1) }] });
      if (!roomError) continue;
      const { x, z, width, depth } = room;
      const roomField = typeof room.name !== 'string' || !room.name.trim() || room.name.length > 256 ? 'name' :
        !Number.isFinite(width) || width < 1 || width * 2 !== Math.round(width * 2) ? 'width' :
        !Number.isFinite(depth) || depth < 1 || depth * 2 !== Math.round(depth * 2) ? 'depth' :
        !Number.isFinite(x) || x < 0 || x + 1 > design.width || x * 2 !== Math.round(x * 2) ? 'x' :
        !Number.isFinite(z) || z < 0 || z + 1 > design.depth || z * 2 !== Math.round(z * 2) ? 'z' :
        x + width > design.width ? 'width' :
        z + depth > design.depth ? 'depth' :
        floor.rooms.slice(0, roomIndex).some(r => x < r.x + r.width && x + width > r.x && z < r.z + r.depth && z + depth > r.z) ? 'x' :
        'width';
      const devices: Array<{
        item: string;
        kind: 'sensor' | 'door' | 'light';
        device: SensorDesignDto | DoorDesignDto | LightDesignDto;
      }> = [
        { item: t('editorSensor', { room: room.name }), kind: 'sensor' as const, device: room.sensor },
        ...room.doors.map((device, i) => ({ item: t('editorDoor', { number: i + 1, room: room.name }), kind: 'door' as const, device })),
        ...room.lights.map((device, i) => ({ item: t('editorLight', { number: i + 1, room: room.name }), kind: 'light' as const, device }))
      ];
      for (const entry of devices) {
        const connectionError = t('editorInvalidConnection', { item: entry.item });
        if ([connectionError, t('editorInvalidPoint', { item: entry.item }), t('editorInvalidDoor', { item: entry.item })].includes(roomError)) {
          const selection: EditorSelection = entry.kind === 'sensor'
            ? { kind: 'sensor', roomId: room.id }
            : entry.kind === 'door'
              ? { kind: 'door', roomId: room.id, id: entry.device.id }
              : { kind: 'light', roomId: room.id, id: entry.device.id };
          return { error: roomError, floor: index, item: entry.item,
            selection,
            field: roomError === connectionError ? 'connection' :
              roomError === t('editorInvalidPoint', { item: entry.item })
                ? pointField(entry.device, x, z, x + width, z + depth) : 'x' };
        }
      }
      return { error: roomError, floor: index, item: t('editorRoom', { name: room.name || room.id }),
        selection: { kind: 'room', roomId: room.id }, field: roomField };
    }
  }
  return { error };
}

export function unappliedFormStatus(hasChanges: boolean): string {
  return hasChanges ? t('editorUnappliedFormStatus') : '';
}

type EditorContext = { floorIndex: number; selection: EditorSelection | null | undefined };

export function sameEditorContext(current: EditorContext | null | undefined, captured: EditorContext | null | undefined): boolean {
  const first = current?.selection, second = captured?.selection;
  const sameSelection = selectionsMatch(first, second);
  return current?.floorIndex === captured?.floorIndex && Boolean(sameSelection);
}

function selectionsMatch(first: EditorSelection | null | undefined, second: EditorSelection | null | undefined): boolean {
  if (first === second) return true;
  if (!first || !second || first.kind !== second.kind) return false;
  switch (first.kind) {
    case 'controller':
      return second.kind === 'controller';
    case 'walkway':
      return second.kind === 'walkway' && first.id === second.id;
    case 'stair':
      return second.kind === 'stair' && first.id === second.id;
    case 'room':
      return second.kind === 'room' && first.roomId === second.roomId;
    case 'sensor':
      return second.kind === 'sensor' && first.roomId === second.roomId;
    case 'door':
      return second.kind === 'door' && first.roomId === second.roomId && first.id === second.id;
    case 'light':
      return second.kind === 'light' && first.roomId === second.roomId && first.id === second.id;
  }
}

export function canFocusValidationField(
  issue: ValidationIssueContext | { problem?: ValidationIssueContext } | null | undefined,
  currentContext: EditorContext,
  formName: EditorFormName,
  fieldEnabled: boolean
): boolean {
  if (!fieldEnabled) return false;
  const problem = getEditorValidationIssue(issue);
  if (problem?.floor !== undefined && problem.floor !== currentContext.floorIndex) return false;
  if (problem?.floor !== undefined && formName === 'building') return false;
  if (formName !== 'properties' || !problem?.selection) return true;
  if (problem.floor === undefined) return false;
  return sameEditorContext(currentContext, { floorIndex: problem.floor, selection: problem.selection });
}

function getEditorValidationIssue(
  issue: ValidationIssueContext | { problem?: ValidationIssueContext } | null | undefined
): ValidationIssueContext | undefined {
  if (!issue) return undefined;
  if ('problem' in issue && issue.problem) return issue.problem;
  if (isValidationIssueContext(issue)) return issue;
  return undefined;
}

function isValidationIssueContext(value: unknown): value is ValidationIssueContext {
  return typeof value === 'object' && value !== null &&
    (('floor' in value && (typeof value.floor === 'number' || value.floor === undefined)) ||
      'selection' in value || 'error' in value);
}

export type NumericValidationResult =
  | { valid: true; value: number }
  | { valid: false; reason: 'syntax' | 'finite' | 'range' | 'step'; value?: number };

export function validateNumericInput(
  raw: string,
  { min, max, step = 0.5 }: EditorNumericConstraints = {}
): NumericValidationResult {
  const text = String(raw).trim();
  if (!numberInputSyntax.test(text)) return { valid: false, reason: 'syntax' };
  const value = Number(text);
  if (!Number.isFinite(value)) return { valid: false, reason: 'finite' };
  const minimum = min === undefined ? null : Number(min);
  const maximum = max === undefined ? null : Number(max);
  if ((minimum !== null && value < minimum) || (maximum !== null && value > maximum))
    return { valid: false, reason: 'range', value };
  if (step === 'any') return { valid: true, value };
  const increment = Number(step);
  if (!Number.isFinite(increment) || increment <= 0) return { valid: false, reason: 'step', value };
  const base = minimum ?? 0;
  if (Math.abs((value - base) / increment - Math.round((value - base) / increment)) > 1e-8)
    return { valid: false, reason: 'step', value };
  return { valid: true, value };
}

export function adjustNumericInput(
  raw: string,
  key: string,
  { min, max, step = 0.5 }: EditorNumericConstraints = {}
): string | null {
  if (key !== 'ArrowUp' && key !== 'ArrowDown') return null;
  const text = String(raw).trim();
  if (text && !numberInputSyntax.test(text)) return null;
  if (step === 'any') {
    const current = text ? Number(text) : min ?? 0;
    if (!Number.isFinite(current)) return null;
    const next = current + (key === 'ArrowUp' ? .5 : -.5);
    if ((min !== undefined && next < min) || (max !== undefined && next > max)) return null;
    return String(Number(next.toPrecision(15)));
  }
  const increment = Number(step);
  if (!Number.isFinite(increment) || increment <= 0) return null;
  const minimum = min === undefined ? null : Number(min);
  const maximum = max === undefined ? null : Number(max);
  const base = minimum ?? 0;
  const current = text ? Number(text) : base;
  if (!Number.isFinite(current)) return null;
  const position = (current - base) / increment;
  const aligned = Math.abs(position - Math.round(position)) < 1e-8;
  const nextPosition = aligned ? Math.round(position) + (key === 'ArrowUp' ? 1 : -1) :
    key === 'ArrowUp' ? Math.ceil(position) : Math.floor(position);
  let next = base + nextPosition * increment;
  if (minimum !== null) next = Math.max(minimum, next);
  if (maximum !== null) next = Math.min(maximum, next);
  if (!text && key === 'ArrowUp') next = base;
  return String(Number(next.toPrecision(12)));
}

type ProjectedFormValue = string | boolean | undefined;
type ProjectedForm = Record<string, ProjectedFormValue>;

export function projectPendingForms(
  design: BuildingDesign,
  pendingForms: FormSnapshot[] | PendingEditorForm[],
  floorIndex: number,
  selection: EditorSelection | null
): EditorPendingProjection {
  const result = structuredClone(design);
  const entries = new Map<EditorFormName | undefined, ProjectedForm>();
  for (const form of pendingForms) {
    const values: ProjectedForm = {};
    for (const field of form.fields) {
      values[String(field.name)] = field.type === 'checkbox' || field.type === 'radio'
        ? field.checked
        : field.value;
    }
    entries.set(form.form, values);
  }
  const number = (data: ProjectedForm, name: string): number | null => {
    const raw = data[name];
    if (typeof raw !== 'string' || !numberInputSyntax.test(raw.trim())) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  };
  const validGrid = (value: number | null): value is number => value !== null && value * 2 === Math.round(value * 2);
  const validBuildingSize = (value: number | null): value is number => validGrid(value) && value >= 2 && value <= 100;
  let newRoomId = null;

  const building = entries.get('building');
  if (building) {
    const count = number(building, 'count');
    const width = number(building, 'width');
    const depth = number(building, 'depth');
    if (!validBuildingSize(width)) return { design: null, issue: { form: 'building', field: 'width' } };
    if (!validBuildingSize(depth)) return { design: null, issue: { form: 'building', field: 'depth' } };
    if (count === null || !Number.isInteger(count) || count < 1 || count > 10)
      return { design: null, issue: { form: 'building', field: 'count' } };
    result.width = width;
    result.depth = depth;
    const removed = result.floors.length > count;
    result.floors.splice(count);
    if (removed && result.floors[count - 1]) result.floors[count - 1]!.stairs = [];
    while (result.floors.length < count) result.floors.push(newFloor(result.floors.length + 1));
  }

  const floor = result.floors[floorIndex];
  const newRoomForm = entries.get('new-room');
  if (newRoomForm) {
    if (!floor) return { design: null, issue: { form: 'new-room', field: 'x' } };
    const x = number(newRoomForm, 'x');
    const z = number(newRoomForm, 'z');
    const width = number(newRoomForm, 'width');
    const depth = number(newRoomForm, 'depth');
    if (x === null) return { design: null, issue: { form: 'new-room', field: 'x' } };
    if (z === null) return { design: null, issue: { form: 'new-room', field: 'z' } };
    if (width === null) return { design: null, issue: { form: 'new-room', field: 'width' } };
    if (depth === null) return { design: null, issue: { form: 'new-room', field: 'depth' } };
    const room = newRoom(
      x, z, width, depth, String(newRoomForm.name), floor.controllerId);
    newRoomId = room.id;
    floor.rooms.push(room);
  }

  const properties = entries.get('properties');
  if (properties) {
    const targetFloor = result.floors[floorIndex];
    if (!targetFloor || !selection) return { design: null, issue: { form: 'properties', field: 'x' } };
    const x = number(properties, 'x');
    const z = number(properties, 'z');
    if (x === null) return { design: null, issue: { form: 'properties', field: 'x' } };
    if (z === null) return { design: null, issue: { form: 'properties', field: 'z' } };
    if (selection.kind === 'controller') {
      targetFloor.controllerX = x;
      targetFloor.controllerZ = z;
    } else if (selection.kind === 'walkway' || selection.kind === 'stair') {
      const item = (selection.kind === 'walkway' ? targetFloor.walkways : targetFloor.stairs)?.find(value => value.id === selection.id);
      const width = number(properties, 'width');
      const depth = number(properties, 'depth');
      if (!item) return { design: null, issue: { form: 'properties', field: 'x' } };
      if (width === null) return { design: null, issue: { form: 'properties', field: 'width' } };
      if (depth === null) return { design: null, issue: { form: 'properties', field: 'depth' } };
      item.x = x; item.z = z; item.width = width; item.depth = depth;
      if ('direction' in item) {
        if (properties.direction !== 'east' && properties.direction !== 'west')
          return { design: null, issue: { form: 'properties', field: 'direction' } };
        item.direction = properties.direction;
      }
    } else if (selection.kind === 'room') {
      const room = targetFloor.rooms.find(item => item.id === selection.roomId);
      const width = number(properties, 'width');
      const depth = number(properties, 'depth');
      if (!room) return { design: null, issue: { form: 'properties', field: 'x' } };
      if (width === null) return { design: null, issue: { form: 'properties', field: 'width' } };
      if (depth === null) return { design: null, issue: { form: 'properties', field: 'depth' } };
      const reshaped = reshapeRoom(room, x, z, width, depth);
      if (!reshaped) return { design: null, issue: { form: 'properties', field: 'width' } };
      Object.assign(room, reshaped);
      room.name = String(properties.name);
    } else {
      const room = targetFloor.rooms.find(item => item.id === selection.roomId);
      if (!room) return { design: null, issue: { form: 'properties', field: 'x' } };
      const item = selection.kind === 'sensor'
        ? room.sensor
        : selection.kind === 'door'
          ? room.doors.find(candidate => candidate.id === selection.id)
          : room.lights.find(candidate => candidate.id === selection.id);
      if (!item) return { design: null, issue: { form: 'properties', field: 'x' } };
      item.x = x;
      item.z = z;
      if (selection.kind === 'sensor' || selection.kind === 'light') {
        const wiredItem = selection.kind === 'sensor'
          ? room.sensor
          : room.lights.find(candidate => candidate.id === selection.id);
        if (!wiredItem) return { design: null, issue: { form: 'properties', field: 'x' } };
        wiredItem.controllerId = typeof properties.connection === 'string' && properties.connection
          ? properties.connection : null;
      }
    }
  }
  const problem = locateValidation(result);
  if (problem) {
    const form = problem.floor === undefined ? 'building' :
      problem.selection && 'roomId' in problem.selection && problem.selection.roomId === newRoomId ? 'new-room' :
        entries.has('properties') && sameEditorContext(
          { floorIndex, selection }, { floorIndex: problem.floor, selection: problem.selection }) ? 'properties' : null;
    return { design: null, issue: { form, field: problem.field || 'x', problem } };
  }
  return { design: result, issue: null };
}

export function createRecoveryExport(
  design: BuildingDesign,
  pendingForms: FormSnapshot[] | PendingEditorForm[],
  context: EditorRecoveryContext,
  reason: string
): object {
  return {
    format: 'building-editor-recovery',
    formatVersion: 1,
    validatedDesign: false,
    projection: 'not-applied',
    reason,
    design: structuredClone(design),
    pendingForms: structuredClone(pendingForms),
    context: structuredClone(context)
  };
}

export function reshapeRoom(room: BuildingRoom, x: number, z: number, width: number, depth: number): BuildingRoom | null {
  const dx = x - room.x, dz = z - room.z;
  const moved = structuredClone(room);
  moved.x = x; moved.z = z; moved.width = width; moved.depth = depth;
  for (const item of [moved.sensor, ...moved.doors, ...moved.lights]) {
    item.x += dx; item.z += dz;
  }
  const inside = (item: { x: number; z: number }): boolean =>
    item.x >= x && item.x <= x + width && item.z >= z && item.z <= z + depth;
  if ((width !== room.width || depth !== room.depth) &&
      (![moved.sensor, ...moved.lights].every(inside) ||
      !moved.doors.every(door => inside(door) && (door.x === x || door.x === x + width || door.z === z || door.z === z + depth))))
    return null;
  return moved;
}

type EditorItem = BuildingFloor | BuildingRoom | SensorDesignDto | DoorDesignDto | LightDesignDto;
type EditorLookup = { floor?: BuildingFloor; room?: BuildingRoom; item?: EditorItem };
type FormProjectionIssue = {
  form: EditorFormName | null;
  field: string;
  problem?: EditorValidationIssue;
};
type EditorOptions = {
  onActivated?: () => void | Promise<void>;
  mutationAccess?: MutationAccess;
};
type EditorInputOptions = EditorNumericConstraints & { text?: boolean; maxLength?: number };

function isEditorTool(value: string): value is EditorTool {
  return value === 'select' || value === 'room' || value === 'door' || value === 'light' || value === 'move';
}

function requireEditorElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing editor element: ${selector}`);
  return element;
}

function requireEditorChild<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing editor element: ${selector}`);
  return element;
}

function isFocusableElement(element: Element | null): element is FocusableEditorElement {
  return element !== null && 'focus' in element && typeof element.focus === 'function' &&
    'dataset' in element && typeof element.dataset === 'object';
}

export function initBuildingEditor({
  onActivated = () => {},
  mutationAccess
}: EditorOptions = {}): void {
  const root = requireEditorElement<HTMLElement>('#buildingEditor');
  const content = requireEditorElement<HTMLElement>('#editorContent');
  const status = requireEditorElement<HTMLElement>('#editorStatus');
  const error = requireEditorElement<HTMLElement>('#editorError');
  error.tabIndex = -1;
  const openButton = requireEditorElement<HTMLButtonElement>('#openEditor');
  let session: EditorSession | null = null;
  let floorIndex = 0;
  let selected: EditorSelection | null = null;
  let tool: EditorTool = 'select';
  let busy = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let opening = false;
  const getSession = (): EditorSession => {
    if (!session) throw new Error(t('editorProtocolError'));
    return session;
  };
  const getDesign = (): BuildingDesign => {
    const design = getSession().design;
    if (!design) throw new Error(t('editorProtocolError'));
    return design;
  };
  const forms = createFormGuard(content, () => confirm(t('editorUnapplied')), () => showStatus());

  const el = (tag: string, text?: string, className?: string): HTMLElement => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const button = (label: string, action: () => void): HTMLButtonElement => {
    const node = document.createElement('button');
    node.textContent = label;
    node.type = 'button';
    node.addEventListener('click', action);
    return node;
  };
  const report = (message: string): void => { error.hidden = !message; error.textContent = message || ''; };
  const showStatus = (): void => {
    openButton.disabled = !mutationAccess?.editorAllowed || !root.hidden || opening;
    const accessStatus = document.querySelector<HTMLElement>('#editorAccessStatus');
    const accessMessage = mutationAccess?.editorMessage || t('mutationAccess_checking');
    if (accessStatus && accessStatus.textContent !== accessMessage) accessStatus.textContent = accessMessage;
    if (!session?.design) return;
    const currentSession = getSession();
    const state = currentSession.conflict ? t('editorConflict') :
      currentSession.dirty ? t('editorDirty') : t('editorSaved');
    const activation = currentSession.activationStatus === 'active' ? t('editorActivationActive') :
      currentSession.activationStatus === 'pending' ? t('editorActivationPending') :
      currentSession.activationStatus === 'failed' ? t('editorActivationFailed') : displayStatus(currentSession.activationStatus);
    const revisions = currentSession.activeDesign && currentSession.saved
      ? t('editorRevisions', { saved: currentSession.saved.revision, running: currentSession.activeDesign.revision }) : '';
    const cleanup = Array.isArray(currentSession.cleanup) ? t('editorCleanup', {
      pending: currentSession.cleanup.filter(c => String(c.status).toLowerCase() === 'pending').length,
      failed: currentSession.cleanup.filter(c => String(c.status).toLowerCase() === 'failed').length,
      completed: currentSession.cleanup.filter(c => String(c.status).toLowerCase() === 'completed').length,
      cancelled: currentSession.cleanup.filter(c => String(c.status).toLowerCase() === 'cancelled').length
    }) : t('editorCleanupUnavailable');
    const refreshError = currentSession.statusError ? t('editorStatusRefreshFailed', { error: currentSession.statusError }) : '';
    const statusText = [
      unappliedFormStatus(forms.hasChanges()),
      state,
      t('editorActivation', { status: activation }),
      revisions,
      cleanup,
      refreshError
    ].filter(Boolean).join(' ');
    const displayText = mutationAccess?.editorAllowed ? statusText : `${mutationAccess?.editorMessage || t('mutationAccess_checking')} ${statusText}`;
    if (status.textContent !== displayText) status.textContent = displayText;
    content.querySelectorAll<HTMLFieldSetElement>('fieldset[data-edit]').forEach(fieldset => {
      fieldset.disabled = busy || currentSession.conflict;
    });
    content.querySelectorAll<HTMLButtonElement>('[data-recovery]').forEach(node => {
      node.hidden = !currentSession.conflict;
    });
    content.querySelectorAll<HTMLButtonElement>('[data-idle]').forEach(node => {
      const blocked = !mutationAccess?.editorAllowed ||
        (currentSession.conflict && node.dataset.recovery !== 'conflict');
      node.disabled = busy || (node.dataset.write === 'true' && blocked) ||
        (node.dataset.history === 'undo' && !currentSession.undoStack.length) ||
        (node.dataset.history === 'redo' && !currentSession.redoStack.length);
    });
    content.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>(
      'form input, form select, form textarea, form button, [data-editor-mutation]'
    ).forEach(node => {
      node.disabled = busy || currentSession.conflict || !mutationAccess?.editorAllowed;
    });
    content.querySelectorAll<HTMLElement>('[data-activation]').forEach(node => {
      node.hidden = !['pending', 'failed'].includes(currentSession.activationStatus);
    });
    content.querySelectorAll<HTMLElement>('[data-cleanup]').forEach(node => {
      node.hidden = !currentSession.cleanup?.some(c => ['pending', 'failed'].includes(String(c.status).toLowerCase()));
    });
  };
  const displayStatus = (value: unknown): string => value == null ? t('editorUnknownStatus') :
    typeof value === 'string' ? value : JSON.stringify(value);
  const run = async (action: () => Promise<void>): Promise<void> => {
    if (busy) return;
    busy = true;
    report('');
    showStatus();
    try { await action(); }
    catch (e) { report(e instanceof Error ? e.message : String(e)); }
    finally { busy = false; showStatus(); }
  };
  const refresh = (): void => { render(); showStatus(); };
  const apply = (
    change: (design: BuildingDesign) => void,
    except: HTMLFormElement | null = null,
    confirmed = false
  ): boolean => {
    if (busy || !mutationAccess?.editorAllowed) return false;
    if (!confirmed && !forms.confirm(except)) return false;
    report(''); getSession().edit(change); refresh();
    return true;
  };
  const floor = (): BuildingFloor => {
    const currentFloor = getDesign().floors[floorIndex];
    if (!currentFloor) throw new Error(t('editorProtocolError'));
    return currentFloor;
  };
  const locate = (design: BuildingDesign, selection: EditorSelection | null = selected): EditorLookup => {
    const f = design.floors[floorIndex];
    if (!selection || !f) return {};
    if (selection.kind === 'controller') return { floor: f, item: f };
    if (selection.kind === 'walkway' || selection.kind === 'stair') return {};
    const room = f.rooms.find(r => r.id === selection.roomId);
    if (!room) return {};
    if (selection.kind === 'room') return { floor: f, room, item: room };
    if (selection.kind === 'sensor') return { floor: f, room, item: room.sensor };
    return {
      floor: f,
      room,
      item: room[selection.kind === 'door' ? 'doors' : 'lights'].find(item => item.id === selection.id)
    };
  };
  const select = (selection: EditorSelection): void => {
    if (busy) return;
    if (!forms.confirm()) return;
    selected = selection; refresh();
  };
  const input = (
    form: HTMLFormElement,
    label: string,
    name: string,
    value: string | number,
    options: EditorInputOptions = {}
  ): void => {
    const wrapper = el('label', label);
    const field = document.createElement('input');
    field.name = name;
    field.type = 'text';
    field.value = String(value);
    field.required = true;
    if (options.text) {
      if (options.maxLength !== undefined) field.maxLength = options.maxLength;
      field.inputMode = 'text';
    } else {
      field.inputMode = 'decimal';
      field.setAttribute('role', 'spinbutton');
      field.pattern = numberInputPattern;
      field.title = t('editorNumericInputHelp');
      if (options.min !== undefined) {
        field.dataset.min = String(options.min);
        field.setAttribute('aria-valuemin', String(options.min));
      }
      if (options.max !== undefined) {
        field.dataset.max = String(options.max);
        field.setAttribute('aria-valuemax', String(options.max));
      }
      field.dataset.step = String(options.step || 0.5);
      const constraints: EditorNumericConstraints = {
        min: options.min,
        max: options.max,
        step: Number(field.dataset.step)
      };
      const updateAria = (raw: string, validation: NumericValidationResult): void => {
        const numeric = validation.valid ? validation.value : validation.value;
        if (numeric !== undefined && Number.isFinite(numeric)) field.setAttribute('aria-valuenow', String(numeric));
        else field.removeAttribute('aria-valuenow');
        if (raw) field.setAttribute('aria-valuetext', raw);
        else field.removeAttribute('aria-valuetext');
        field.setAttribute('aria-invalid', String(!field.validity.valid));
      };
      const validate = () => {
        const raw = field.value.trim();
        const result = validateNumericInput(raw, constraints);
        field.setCustomValidity(!result.valid && ['finite', 'range', 'step'].includes(result.reason)
          ? t('editorNumericConstraint') : '');
        updateAria(raw, result);
      };
      field.addEventListener('input', validate);
      field.addEventListener('blur', validate);
      field.addEventListener('keydown', event => {
        const next = adjustNumericInput(field.value, event.key, constraints);
        if (next === null) return;
        event.preventDefault();
        field.value = next;
        validate();
        field.dispatchEvent(new Event('input', { bubbles: true }));
      });
      validate();
    }
    wrapper.append(field);
    form.append(wrapper);
  };
  const formButton = (form: HTMLFormElement, label: string): void => {
    const submit = document.createElement('button');
    submit.textContent = label;
    submit.type = 'submit';
    form.append(submit);
  };
  const svg = <K extends keyof SVGElementTagNameMap>(
    name: K,
    attributes: Record<string, string | number>
  ): SVGElementTagNameMap[K] => {
    const node = document.createElementNS(svgNs, name);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    return node;
  };
  const renderPlan = (parent: HTMLElement): void => {
    const design = getDesign();
    const plan = svg('svg', { viewBox: `0 0 ${design.width} ${design.depth}`, role: 'img', 'aria-label': t('editorPlan') });
    plan.classList.add('editor-plan');
    const current = floor();
    const point = (
      x: number,
      z: number,
      kind: 'sensor' | 'door' | 'light' | 'controller',
      selection: EditorSelection
    ): void => {
      const circle = svg('circle', { cx: x, cy: z, r: Math.max(design.width, design.depth) * .014, class: `editor-${kind}` });
      circle.addEventListener('click', event => { if (tool === 'select') { event.stopPropagation(); select(selection); } });
      plan.append(circle);
    };
    for (const room of current.rooms) {
      const rect = svg('rect', { x: room.x, y: room.z, width: room.width, height: room.depth, class: 'editor-room' });
      rect.addEventListener('click', event => { if (tool === 'select') { event.stopPropagation(); select({ kind: 'room', roomId: room.id }); } });
      plan.append(rect);
      const label = svg('text', { x: room.x + .3, y: room.z + .8, 'font-size': Math.max(.5, design.width / 45) });
      label.textContent = room.name;
      plan.append(label);
      const controller = { x: current.controllerX, z: current.controllerZ };
      for (const device of [room.sensor, ...room.lights]) {
        if (device.controllerId === current.controllerId)
          plan.append(svg('line', { x1: controller.x, y1: controller.z, x2: device.x, y2: device.z, class: device === room.sensor ? 'editor-sensor-wire' : 'editor-light-wire' }));
      }
      point(room.sensor.x, room.sensor.z, 'sensor', { kind: 'sensor', roomId: room.id });
      room.doors.forEach(d => point(d.x, d.z, 'door', { kind: 'door', roomId: room.id, id: d.id }));
      room.lights.forEach(l => point(l.x, l.z, 'light', { kind: 'light', roomId: room.id, id: l.id }));
    }
    point(current.controllerX, current.controllerZ, 'controller', { kind: 'controller' });
    plan.addEventListener('click', event => {
      if (tool === 'select') return;
      const matrix = plan.getScreenCTM();
      if (!matrix) return;
      const position = plan.createSVGPoint();
      position.x = event.clientX; position.y = event.clientY;
      const coords = position.matrixTransform(matrix.inverse());
      const x = snap(Math.max(0, Math.min(design.width, coords.x)));
      const z = snap(Math.max(0, Math.min(design.depth, coords.y)));
      if (tool === 'room') {
        apply(d => d.floors[floorIndex].rooms.push(newRoom(x, z, 2, 2, t('editorNewRoom'), d.floors[floorIndex].controllerId)));
      } else if (tool === 'move') {
        const selection = selected;
        if (!selection || !locate(design, selection).item) { report(t('editorNoMove')); return; }
        apply(d => {
          const found = locate(d, selection);
          if (selection.kind === 'controller' && found.floor) {
            found.floor.controllerX = x;
            found.floor.controllerZ = z;
          } else if (selection.kind === 'room' && found.room) {
            const reshaped = reshapeRoom(found.room, x, z, found.room.width, found.room.depth);
            if (reshaped) Object.assign(found.room, reshaped);
          } else if (found.room) {
            const item = selection.kind === 'sensor'
              ? found.room.sensor
              : selection.kind === 'door'
                ? found.room.doors.find(candidate => candidate.id === selection.id)
                : selection.kind === 'light'
                  ? found.room.lights.find(candidate => candidate.id === selection.id)
                  : undefined;
            if (item) { item.x = x; item.z = z; }
          }
        });
      } else {
        if (!locate(design).room) { report(t('editorClickRoom')); return; }
        apply(d => {
          const found = locate(d);
          if (!found.room || !found.floor) return;
          if (tool === 'door') found.room.doors.push({ id: newId('door'), x, z });
          else found.room.lights.push({ id: newId('light'), x, z, controllerId: found.floor.controllerId });
        });
      }
    });
    parent.append(plan);
  };

  const render = () => {
    const currentSession = session;
    if (!currentSession?.design) return;
    const design = currentSession.design;
    floorIndex = Math.min(floorIndex, design.floors.length - 1);
    const activeElement = document.activeElement;
    const active = isFocusableElement(activeElement) && content.contains(activeElement) ? activeElement : null;
    const focusText = active?.tagName === 'BUTTON' ? active.textContent : null;
    const focusKey = active?.dataset.focusKey;
    content.replaceChildren();
    const actions = el('div', undefined, 'editor-actions');
    const action = (label: string, fn: () => void, recovery?: string): HTMLButtonElement => {
      const b = button(label, fn);
      b.dataset.idle = '';
      if (recovery) b.dataset.recovery = recovery;
      actions.append(b);
      return b;
    };
    const focusProblem = (
      problem: EditorValidationIssue | FormProjectionIssue,
      formName: EditorFormName | null
    ): void => {
      const field = problem?.field;
      const target = field && formName
        ? content.querySelector<HTMLElement>(`form[data-form="${formName}"] [name="${field}"]`)
        : null;
      const currentContext = { floorIndex, selection: selected };
      const enabled = target !== null && !target.matches(':disabled');
      if (formName && canFocusValidationField(problem, currentContext, formName, enabled)) target?.focus();
      else error.focus();
    };
    const saveButton = action(t('editorSave'), () => {
      const problem = locateValidation(design);
      if (problem) {
        const message = problem.floor === undefined ? t('editorValidationBuilding', { error: problem.error }) :
          t('editorValidationLocation', { floor: design.floors[problem.floor].number, item: problem.item, error: problem.error });
        if (forms.hasChanges()) {
          report(t('editorValidationUnapplied', { error: message }));
          error.focus();
          return;
        }
        if (problem.floor !== undefined) { floorIndex = problem.floor; selected = problem.selection ?? null; refresh(); }
        report(message);
        const formName = problem.floor === undefined ? 'building' : 'properties';
        focusProblem(problem, formName);
        return;
      }
      if (!forms.confirm()) return;
      void run(async () => {
      await currentSession.save();
      await onActivated();
      refresh();
      });
    });
    saveButton.dataset.write = 'true';
    const retryActivation = action(t('editorRetryActivation'), () => run(async () => {
      await currentSession.retryWork('/retry');
      await onActivated();
    }));
    retryActivation.dataset.write = 'true'; retryActivation.dataset.activation = '';
    const retryCleanup = action(t('editorRetryCleanup'), () => run(() => currentSession.retryWork('/retry-cleanup')));
    retryCleanup.dataset.write = 'true'; retryCleanup.dataset.cleanup = '';
    const undo = action(t('editorUndo'), () => { if (forms.confirm()) { currentSession.history(currentSession.undoStack, currentSession.redoStack); refresh(); } });
    undo.dataset.write = 'true'; undo.dataset.history = 'undo';
    const redo = action(t('editorRedo'), () => { if (forms.confirm()) { currentSession.history(currentSession.redoStack, currentSession.undoStack); refresh(); } });
    redo.dataset.write = 'true'; redo.dataset.history = 'redo';
    action(t('editorUseCurrent'), () => {
      if (!confirm(t('editorUseCurrentConfirm'))) return;
      void run(async () => { await currentSession.useCurrent(); selected = null; refresh(); });
    }, 'conflict').dataset.write = 'true';
    action(t('editorExport'), () => {
      const pendingForms = forms.pending();
      const download = (value: unknown, filename: string): void => {
        const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 0);
      };
      const exportRecovery = (reason: string, issue?: EditorValidationIssue | FormProjectionIssue): void => {
        download(createRecoveryExport(design, pendingForms, {
          floorIndex,
          floorNumber: design.floors[floorIndex]?.number ?? null,
          selection: selected,
          conflict: Boolean(currentSession.conflict),
          savedRevision: currentSession.saved?.revision ?? null,
          editRevision: currentSession.editRevision ?? null
        }, reason), 'building-design-recovery.json');
        report(t('editorRecoveryExported'));
        if (issue) focusProblem(issue, 'form' in issue ? issue.form : null);
      };
      for (const pending of pendingForms) {
        const form = [...content.querySelectorAll<HTMLFormElement>('form')].find(candidate => candidate.dataset.form === pending.form);
        const invalid = form && [...form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
          'input, select, textarea'
        )].find(field => !field.checkValidity());
        if (invalid) {
          exportRecovery(invalid.validationMessage || t('editorPendingProjectionInvalid'), {
            form: pending.form ?? null,
            field: invalid.name
          });
          return;
        }
      }
      const projected = projectPendingForms(design, pendingForms, floorIndex, selected);
      if (projected.issue) {
        const problem = projected.issue.problem;
        const message = problem ? problem.floor === undefined ? t('editorValidationBuilding', { error: problem.error }) :
          t('editorValidationLocation', { floor: design.floors[problem.floor]?.number, item: problem.item, error: problem.error }) :
          projected.issue.form === 'properties' && projected.issue.field === 'width'
            ? t('editorResizeFixtures') : t('editorPendingProjectionInvalid');
        exportRecovery(message, projected.issue);
        return;
      }
      download(projected.design, 'building-design.json');
    });
    action(t('editorExit'), () => {
      void run(async () => {
      if ((forms.hasChanges() || currentSession.dirty) && !confirm(t('editorExitConfirm'))) return;
      await close();
      });
    });
    content.append(actions, el('p', t('editorHistory'), 'editor-help'));

    const layout = el('div', undefined, 'editor-layout');
    const settings = el('fieldset'); settings.dataset.edit = '';
    settings.append(el('legend', t('editorBuilding')));
    const buildingForm = document.createElement('form');
    buildingForm.dataset.form = 'building';
    input(buildingForm, t('editorWidth'), 'width', design.width, { min: 2, max: 100 });
    input(buildingForm, t('editorDepth'), 'depth', design.depth, { min: 2, max: 100 });
    input(buildingForm, t('editorFloorCount'), 'count', design.floors.length, { min: 1, max: 10, step: 1 });
    formButton(buildingForm, t('editorApply'));
    buildingForm.addEventListener('submit', event => {
      event.preventDefault();
      const data = new FormData(buildingForm);
      const count = Number(data.get('count'));
      const removed = design.floors.slice(count);
      if (removed.length) {
        const rooms = removed.flatMap(f => f.rooms);
        if (!confirm(t('editorFloorRemove', { floors: removed.length, rooms: rooms.length, doors: rooms.reduce((n, r) => n + r.doors.length, 0), lights: rooms.reduce((n, r) => n + r.lights.length, 0) }))) return;
      }
      apply(d => {
        d.width = Number(data.get('width')); d.depth = Number(data.get('depth'));
        d.floors.splice(count);
        while (d.floors.length < count) d.floors.push(newFloor(d.floors.length + 1));
      }, buildingForm);
    });
    settings.append(buildingForm);
    const floorLabel = el('label', t('editorFloors'));
    const floorSelect = document.createElement('select');
    floorSelect.dataset.focusKey = 'floor';
    design.floors.forEach((f, index) => {
      const option = document.createElement('option');
      option.textContent = t('editorFloor', { number: f.number });
      option.value = String(index); option.selected = index === floorIndex; floorSelect.append(option);
    });
    floorSelect.addEventListener('change', () => {
      if (!forms.confirm()) { floorSelect.value = String(floorIndex); return; }
      floorIndex = Number(floorSelect.value); selected = null; refresh();
      content.querySelector<HTMLElement>('[data-focus-key="floor"]')?.focus({ preventScroll: true });
    });
    floorLabel.append(floorSelect); settings.append(floorLabel);
    layout.append(settings);

    const workspace = el('fieldset'); workspace.dataset.edit = '';
    workspace.append(el('legend', t('editorPlan')), el('p', t('editorPlanHelp'), 'editor-help'));
    const toolLabel = el('label', t('editorTool'));
    const toolSelect = document.createElement('select');
    toolSelect.dataset.editorMutation = '';
    toolSelect.dataset.focusKey = 'tool';
    const toolOptions: Array<[EditorTool, string]> = [
      ['select', 'editorSelect'], ['room', 'editorAddRoom'], ['door', 'editorAddDoor'],
      ['light', 'editorAddLight'], ['move', 'editorMove']
    ];
    for (const [value, key] of toolOptions) {
      const option = document.createElement('option');
      option.textContent = t(key);
      option.value = value;
      option.selected = tool === value;
      toolSelect.append(option);
    }
    toolSelect.addEventListener('change', () => {
      if (isEditorTool(toolSelect.value)) tool = toolSelect.value;
    });
    toolLabel.append(toolSelect); workspace.append(toolLabel);
    renderPlan(workspace);
    layout.append(workspace);

    const properties = el('fieldset'); properties.dataset.edit = '';
    properties.append(el('legend', t('editorItems')));
    const list = el('div', undefined, 'editor-items');
    const itemButton = (label: string, selection: EditorSelection): void => {
      const b = button(label, () => select(selection));
      b.setAttribute('aria-pressed', String(JSON.stringify(selection) === JSON.stringify(selected)));
      list.append(b);
    };
    itemButton(t('editorController'), { kind: 'controller' });
    const currentFloor = floor();
    if (!currentFloor.rooms.length) list.append(el('p', t('editorNoRooms')));
    currentFloor.rooms.forEach(room => {
      itemButton(t('editorRoom', { name: room.name }), { kind: 'room', roomId: room.id });
      const connection = (item: SensorDesignDto | LightDesignDto): string =>
        item.controllerId === currentFloor.controllerId ? t('editorConnected') : t('editorDisconnected');
      itemButton(`${t('editorSensor', { room: room.name })} — ${connection(room.sensor)}`, { kind: 'sensor', roomId: room.id });
      room.doors.forEach((door, i) => itemButton(t('editorDoor', { number: i + 1, room: room.name }), { kind: 'door', roomId: room.id, id: door.id }));
      room.lights.forEach((light, i) => itemButton(`${t('editorLight', { number: i + 1, room: room.name })} — ${connection(light)}`, { kind: 'light', roomId: room.id, id: light.id }));
    });
    properties.append(list);
    renderProperties(properties);
    layout.append(properties);
    content.append(layout);
    content.querySelectorAll('form').forEach(form => forms.track(form));
    showStatus();
    if (focusKey) content.querySelector<HTMLElement>(`[data-focus-key="${focusKey}"]`)?.focus({ preventScroll: true });
    else if (focusText) {
      const replacement = [...content.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === focusText && !node.disabled);
      (replacement || requireEditorChild<HTMLElement>(root, '#editorHeading')).focus({ preventScroll: true });
    }
  };

  const renderProperties = (parent: HTMLElement): void => {
    const newForm = document.createElement('form');
    newForm.dataset.form = 'new-room';
    newForm.append(el('h3', t('editorAddRoom')));
    input(newForm, t('editorName'), 'name', t('editorNewRoom'), { text: true, maxLength: 256 });
    input(newForm, t('editorX'), 'x', 0);
    input(newForm, t('editorZ'), 'z', 0);
    input(newForm, t('editorRoomWidth'), 'width', 2, { min: 1 });
    input(newForm, t('editorRoomDepth'), 'depth', 2, { min: 1 });
    formButton(newForm, t('editorAddRoomForm'));
    newForm.addEventListener('submit', event => {
      event.preventDefault();
      const data = new FormData(newForm);
      apply(d => d.floors[floorIndex].rooms.push(newRoom(
        Number(data.get('x')), Number(data.get('z')), Number(data.get('width')), Number(data.get('depth')),
        String(data.get('name')), d.floors[floorIndex].controllerId)), newForm);
    });
    parent.append(newForm);
    const selection = selected;
    if (!selection) return;
    const found = locate(getDesign(), selection);
    if (!found.item || !found.floor) return;
    const form = document.createElement('form');
    form.dataset.form = 'properties';
    form.append(el('h3', t('editorProperties')));
    if (selection.kind === 'room' && found.room)
      input(form, t('editorName'), 'name', found.room.name, { text: true, maxLength: 256 });
    let x: number;
    let z: number;
    if (selection.kind === 'controller') {
      x = found.floor.controllerX;
      z = found.floor.controllerZ;
    } else if (selection.kind === 'room') {
      if (!found.room) return;
      x = found.room.x;
      z = found.room.z;
    } else {
      if (!('x' in found.item) || !('z' in found.item)) return;
      x = found.item.x;
      z = found.item.z;
    }
    input(form, t('editorX'), 'x', x);
    input(form, t('editorZ'), 'z', z);
    if (selection.kind === 'room' && found.room) {
      input(form, t('editorRoomWidth'), 'width', found.room.width, { min: 1 });
      input(form, t('editorRoomDepth'), 'depth', found.room.depth, { min: 1 });
    }
    if (selection.kind === 'sensor' || selection.kind === 'light') {
      const label = el('label', t('editorConnection'));
      const selectConnection = document.createElement('select');
      selectConnection.name = 'connection';
      const connectionOptions: Array<[string, string]> = [
        ['', t('editorNoConnection')], [found.floor.controllerId, t('editorConnected')]
      ];
      const currentItem = selection.kind === 'sensor'
        ? found.room?.sensor
        : found.room?.lights.find(candidate => candidate.id === selection.id);
      for (const [value, labelText] of connectionOptions) {
        const option = document.createElement('option');
        option.textContent = labelText;
        option.value = value; option.selected = value === (currentItem?.controllerId || ''); selectConnection.append(option);
      }
      label.append(selectConnection); form.append(label);
    }
    formButton(form, t('editorApply'));
    form.addEventListener('submit', event => {
      event.preventDefault();
      const data = new FormData(form);
      const reshaped = selection.kind === 'room' && found.room
        ? reshapeRoom(found.room, Number(data.get('x')), Number(data.get('z')), Number(data.get('width')), Number(data.get('depth')))
        : null;
      if (selection.kind === 'room' && !reshaped) { report(t('editorResizeFixtures')); return; }
      apply(d => {
        const current = locate(d, selection);
        if (selection.kind === 'controller' && current.floor) {
          current.floor.controllerX = Number(data.get('x'));
          current.floor.controllerZ = Number(data.get('z'));
        } else if (selection.kind === 'room' && current.room && reshaped) {
          Object.assign(current.room, reshaped);
          current.room.name = String(data.get('name'));
        } else if (current.room) {
          const item = selection.kind === 'sensor'
            ? current.room.sensor
            : selection.kind === 'door'
              ? current.room.doors.find(candidate => candidate.id === selection.id)
              : selection.kind === 'light'
                ? current.room.lights.find(candidate => candidate.id === selection.id)
                : undefined;
          if (!item) return;
          item.x = Number(data.get('x'));
          item.z = Number(data.get('z'));
          if (selection.kind === 'sensor' || selection.kind === 'light') {
            const wiredItem = selection.kind === 'sensor'
              ? current.room.sensor
              : current.room.lights.find(candidate => candidate.id === selection.id);
            const connection = data.get('connection');
            if (wiredItem) wiredItem.controllerId = typeof connection === 'string' && connection ? connection : null;
          }
        }
      }, form);
    });
    parent.append(form);
    if (found.room) {
      const addDoor = button(t('editorAddDoor'), () => apply(d => {
        const room = locate(d, selection).room;
        if (!room) return;
        room.doors.push({ id: newId('door'), x: room.x, z: room.z });
      }));
      const addLight = button(t('editorAddLight'), () => apply(d => {
        const { room, floor: f } = locate(d, selection);
        if (!room || !f) return;
        room.lights.push({ id: newId('light'), x: room.x, z: room.z, controllerId: f.controllerId });
      }));
      parent.append(addDoor, addLight);
      addDoor.dataset.editorMutation = '';
      addLight.dataset.editorMutation = '';
    }
    if (selection.kind === 'room' || selection.kind === 'door' || selection.kind === 'light') {
      const remove = button(t('editorDelete'), () => {
        const message = selection.kind === 'room' && found.room
          ? t('editorRoomRemove', { room: found.room.name, doors: found.room.doors.length, lights: found.room.lights.length })
          : t('editorDeleteConfirm', { item: selection.kind === 'door' ? t('editorAddDoor') : t('editorAddLight') });
        if (!forms.confirm() || !confirm(message)) return;
        apply(d => {
          const current = locate(d);
          if (selection.kind === 'room' && current.floor && current.room) {
            const roomId = current.room.id;
            current.floor.rooms = current.floor.rooms.filter(r => r.id !== roomId);
          }
          else {
            if (!current.room) return;
            if (selection.kind === 'door')
              current.room.doors = current.room.doors.filter(item => item.id !== selection.id);
            else if (selection.kind === 'light')
              current.room.lights = current.room.lights.filter(item => item.id !== selection.id);
          }
        }, null, true);
        selected = null; refresh();
      });
      remove.dataset.editorMutation = '';
      parent.append(remove);
    }
  };

  const close = async () => {
    clearInterval(heartbeat);
    root.hidden = true;
    content.replaceChildren();
    session = null;
    showStatus();
    if (!openButton.disabled) openButton.focus();
    else requireEditorElement<HTMLElement>('.editor-menu summary').focus();
  };

  const load = async () => {
    if (opening) return;
    const access = mutationAccess;
    if (!access?.editorAllowed) { status.textContent = ''; report(access?.editorMessage || t('mutationAccess_checking')); return; }
    opening = true;
    status.textContent = t('editorLoading');
    report('');
    content.replaceChildren();
    session = new EditorSession((url, options) => access.request(url, options, true), showStatus);
    try {
      await session.open();
      floorIndex = 0; selected = null; tool = 'select';
      heartbeat = setInterval(() => { session?.refreshStatus(); }, 20000);
      refresh();
    } catch (e) {
      status.textContent = '';
      report(t('editorLoadFailed', { error: e instanceof Error ? e.message : String(e) }));
      const retry = button(t('editorRetry'), load);
      retry.dataset.editorMutation = '';
      retry.disabled = !mutationAccess?.editorAllowed;
      content.append(retry);
      content.append(button(t('editorReturn'), () => run(close)));
    } finally {
      opening = false;
      showStatus();
    }
  };
  const open = () => {
    if (!root.hidden || opening || !mutationAccess?.editorAllowed) return;
    root.hidden = false;
    openButton.disabled = true;
    requireEditorChild<HTMLElement>(root, '#editorHeading').focus();
    return load();
  };
  openButton.addEventListener('click', open);
  mutationAccess?.subscribe(() => {
    if (!mutationAccess.editorAllowed) {
      tool = 'select';
      const selector = content.querySelector<HTMLSelectElement>('[data-focus-key="tool"]');
      if (selector) selector.value = tool;
    }
    showStatus();
    content.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>('[data-editor-mutation]').forEach(node => {
      node.disabled = busy || !mutationAccess.editorAllowed || Boolean(session?.conflict);
    });
  });
  window.addEventListener('beforeunload', event => {
    if (session?.design && (forms.hasChanges() || session.dirty)) {
      event.preventDefault();
      event.returnValue = t('editorBeforeUnload');
    }
  });
}
