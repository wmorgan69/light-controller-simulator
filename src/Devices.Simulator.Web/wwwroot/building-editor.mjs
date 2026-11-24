import { t } from './localization.en.mjs?v=6';
import { EditorSession, newFloor, newId, newRoom, snap, validateDesign } from './building-editor-state.mjs?v=local-edits-6';

const svgNs = 'http://www.w3.org/2000/svg';
const numberInputPattern = '-?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)(?:[eE](?:\\+|-)?[0-9]+)?';
const numberInputSyntax = new RegExp(`^(?:${numberInputPattern})$`);

export function createFormGuard(content, confirmDiscard, onChange = () => {}) {
  const initial = new WeakMap();
  const fields = form => [...form.querySelectorAll('input, select, textarea')];
  const value = field => field.type === 'checkbox' || field.type === 'radio' ? field.checked : field.value;
  const formId = form => form.dataset.form;
  const snapshotForm = form => ({
    form: formId(form),
    fields: fields(form).map(field => ({
      name: field.name,
      type: field.type,
      value: field.value,
      checked: field.checked
    }))
  });
  const changedForms = except => [...content.querySelectorAll('form')].filter(form =>
    form !== except && initial.has(form) && fields(form).some((field, index) => value(field) !== initial.get(form)[index]));
  if (content.addEventListener) {
    content.addEventListener('input', onChange);
    content.addEventListener('change', onChange);
  }
  return {
    track(form) { initial.set(form, fields(form).map(value)); },
    hasChanges() { return changedForms().length > 0; },
    capture() { return changedForms().map(snapshotForm); },
    pending() { return changedForms().map(snapshotForm); },
    restore(snapshots) {
      let dispatched = false;
      for (const snapshot of snapshots) {
        const form = [...content.querySelectorAll('form')].find(candidate => formId(candidate) === snapshot.form);
        if (!form) continue;
        const currentFields = fields(form);
        for (const saved of snapshot.fields) {
          const field = currentFields.find(candidate => candidate.name === saved.name);
          if (!field) continue;
          if (field.type === 'checkbox' || field.type === 'radio') field.checked = saved.checked;
          else field.value = saved.value;
          if (field.dispatchEvent && typeof Event !== 'undefined') {
            field.dispatchEvent(new Event('input', { bubbles: true }));
            dispatched = true;
          }
        }
      }
      if (!dispatched) onChange();
    },
    confirm(except) {
      const changed = changedForms(except);
      if (!changed.length) return true;
      if (!confirmDiscard()) return false;
      for (const form of changed) fields(form).forEach((field, index) => {
        if (field.type === 'checkbox' || field.type === 'radio') field.checked = initial.get(form)[index];
        else field.value = initial.get(form)[index];
        if (field.dispatchEvent && typeof Event !== 'undefined')
          field.dispatchEvent(new Event('input', { bubbles: true }));
      });
      onChange();
      return true;
    }
  };
}

export function locateValidation(design) {
  const error = validateDesign(design);
  if (!error) return null;
  const pointField = (point, x, z, right, bottom) =>
    !Number.isFinite(point.x) || point.x < x || point.x > right || point.x * 2 !== Math.round(point.x * 2) ? 'x' :
      !Number.isFinite(point.z) || point.z < z || point.z > bottom || point.z * 2 !== Math.round(point.z * 2) ? 'z' : 'x';
  if (error === t('editorInvalidBuilding')) {
    const validSize = value => Number.isFinite(value) && value >= 2 && value <= 100 && value * 2 === Math.round(value * 2);
    return { error, field: !validSize(design.width) ? 'width' : !validSize(design.depth) ? 'depth' : 'count' };
  }
  for (const [index, floor] of design.floors.entries()) {
    const floorError = validateDesign({ ...design, floors: [floor] });
    if (!floorError) continue;
    const controller = t('editorController');
    if (floorError === t('editorInvalidPoint', { item: controller }))
      return { error: floorError, floor: index, selection: { kind: 'controller' }, item: controller,
        field: pointField({ x: floor.controllerX, z: floor.controllerZ }, 0, 0, design.width, design.depth) };
    for (const [roomIndex, room] of floor.rooms.entries()) {
      const roomError = validateDesign({ ...design, floors: [{ ...floor, rooms: floor.rooms.slice(0, roomIndex + 1) }] });
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
      const devices = [
        { item: t('editorSensor', { room: room.name }), kind: 'sensor', device: room.sensor },
        ...room.doors.map((device, i) => ({ item: t('editorDoor', { number: i + 1, room: room.name }), kind: 'door', device })),
        ...room.lights.map((device, i) => ({ item: t('editorLight', { number: i + 1, room: room.name }), kind: 'light', device }))
      ];
      for (const entry of devices) {
        const connectionError = t('editorInvalidConnection', { item: entry.item });
        if ([connectionError, t('editorInvalidPoint', { item: entry.item }), t('editorInvalidDoor', { item: entry.item })].includes(roomError))
          return { error: roomError, floor: index, item: entry.item,
            selection: { kind: entry.kind, roomId: room.id, ...(entry.kind === 'sensor' ? {} : { id: entry.device.id }) },
            field: roomError === connectionError ? 'connection' :
              roomError === t('editorInvalidPoint', { item: entry.item })
                ? pointField(entry.device, x, z, x + width, z + depth) : 'x' };
      }
      return { error: roomError, floor: index, item: t('editorRoom', { name: room.name || room.id }),
        selection: { kind: 'room', roomId: room.id }, field: roomField };
    }
  }
  return { error };
}

export function unappliedFormStatus(hasChanges) {
  return hasChanges ? t('editorUnappliedFormStatus') : '';
}

export function sameEditorContext(current, captured) {
  const first = current?.selection, second = captured?.selection;
  const sameSelection = first === second || (first && second && first.kind === second.kind &&
    first.roomId === second.roomId && first.id === second.id);
  return current?.floorIndex === captured?.floorIndex && Boolean(sameSelection);
}

export function canFocusValidationField(issue, currentContext, formName, fieldEnabled) {
  if (!fieldEnabled) return false;
  const problem = issue?.problem || issue;
  if (problem?.floor !== undefined && problem.floor !== currentContext.floorIndex) return false;
  if (problem?.floor !== undefined && formName === 'building') return false;
  return formName !== 'properties' || !problem?.selection ||
    sameEditorContext(currentContext, { floorIndex: problem.floor, selection: problem.selection });
}

export function validateNumericInput(raw, { min, max, step = 0.5 } = {}) {
  const text = String(raw).trim();
  if (!numberInputSyntax.test(text)) return { valid: false, reason: 'syntax' };
  const value = Number(text);
  if (!Number.isFinite(value)) return { valid: false, reason: 'finite' };
  const minimum = min === undefined ? null : Number(min);
  const maximum = max === undefined ? null : Number(max);
  const increment = Number(step);
  if ((minimum !== null && value < minimum) || (maximum !== null && value > maximum))
    return { valid: false, reason: 'range', value };
  if (!Number.isFinite(increment) || increment <= 0) return { valid: false, reason: 'step', value };
  const base = minimum ?? 0;
  if (Math.abs((value - base) / increment - Math.round((value - base) / increment)) > 1e-8)
    return { valid: false, reason: 'step', value };
  return { valid: true, value };
}

export function adjustNumericInput(raw, key, { min, max, step = 0.5 } = {}) {
  if (key !== 'ArrowUp' && key !== 'ArrowDown') return null;
  const text = String(raw).trim();
  if (text && !numberInputSyntax.test(text)) return null;
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

export function projectPendingForms(design, pendingForms, floorIndex, selection) {
  const result = structuredClone(design);
  const entries = new Map(pendingForms.map(form => [form.form, Object.fromEntries(form.fields.map(field => [field.name,
    field.type === 'checkbox' || field.type === 'radio' ? field.checked : field.value]))]));
  const number = (data, name) => {
    const raw = data[name];
    if (typeof raw !== 'string' || !numberInputSyntax.test(raw.trim())) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  };
  const validGrid = value => value !== null && value * 2 === Math.round(value * 2);
  const validBuildingSize = value => validGrid(value) && value >= 2 && value <= 100;
  let newRoomId = null;

  const building = entries.get('building');
  if (building) {
    const count = number(building, 'count');
    const width = number(building, 'width');
    const depth = number(building, 'depth');
    if (!validBuildingSize(width)) return { design: null, issue: { form: 'building', field: 'width' } };
    if (!validBuildingSize(depth)) return { design: null, issue: { form: 'building', field: 'depth' } };
    if (!Number.isInteger(count) || count < 1 || count > 10)
      return { design: null, issue: { form: 'building', field: 'count' } };
    result.width = width;
    result.depth = depth;
    result.floors.splice(count);
    while (result.floors.length < count) result.floors.push(newFloor(result.floors.length + 1));
  }

  const floor = result.floors[floorIndex];
  const newRoomForm = entries.get('new-room');
  if (newRoomForm) {
    if (!floor) return { design: null, issue: { form: 'new-room', field: 'x' } };
    for (const name of ['x', 'z', 'width', 'depth']) {
      if (number(newRoomForm, name) === null) return { design: null, issue: { form: 'new-room', field: name } };
    }
    const room = newRoom(
      number(newRoomForm, 'x'), number(newRoomForm, 'z'), number(newRoomForm, 'width'), number(newRoomForm, 'depth'),
      String(newRoomForm.name), floor.controllerId);
    newRoomId = room.id;
    floor.rooms.push(room);
  }

  const properties = entries.get('properties');
  if (properties) {
    const targetFloor = result.floors[floorIndex];
    if (!targetFloor || !selection) return { design: null, issue: { form: 'properties', field: 'x' } };
    for (const name of ['x', 'z', ...(selection.kind === 'room' ? ['width', 'depth'] : [])]) {
      if (number(properties, name) === null) return { design: null, issue: { form: 'properties', field: name } };
    }
    const room = targetFloor.rooms.find(item => item.id === selection.roomId);
    const item = selection.kind === 'controller' ? targetFloor :
      selection.kind === 'room' ? room :
        selection.kind === 'sensor' ? room?.sensor :
          room?.[selection.kind === 'door' ? 'doors' : 'lights']?.find(candidate => candidate.id === selection.id);
    if (!item) return { design: null, issue: { form: 'properties', field: 'x' } };
    if (selection.kind === 'controller') {
      item.controllerX = number(properties, 'x');
      item.controllerZ = number(properties, 'z');
    } else if (selection.kind === 'room') {
      const reshaped = reshapeRoom(room, number(properties, 'x'), number(properties, 'z'),
        number(properties, 'width'), number(properties, 'depth'));
      if (!reshaped) return { design: null, issue: { form: 'properties', field: 'width' } };
      Object.assign(item, reshaped);
      item.name = String(properties.name);
    } else {
      item.x = number(properties, 'x');
      item.z = number(properties, 'z');
    }
    if (selection.kind === 'sensor' || selection.kind === 'light')
      item.controllerId = properties.connection || null;
  }
  const problem = locateValidation(result);
  if (problem) {
    const form = problem.floor === undefined ? 'building' :
      problem.selection?.roomId === newRoomId ? 'new-room' :
        entries.has('properties') && sameEditorContext(
          { floorIndex, selection }, { floorIndex: problem.floor, selection: problem.selection }) ? 'properties' : null;
    return { design: null, issue: { form, field: problem.field || 'x', problem } };
  }
  return { design: result, issue: null };
}

export function createRecoveryExport(design, pendingForms, context, reason) {
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

export function reshapeRoom(room, x, z, width, depth) {
  const dx = x - room.x, dz = z - room.z;
  const moved = structuredClone(room);
  moved.x = x; moved.z = z; moved.width = width; moved.depth = depth;
  for (const item of [moved.sensor, ...moved.doors, ...moved.lights]) {
    item.x += dx; item.z += dz;
  }
  const inside = item => item.x >= x && item.x <= x + width && item.z >= z && item.z <= z + depth;
  if ((width !== room.width || depth !== room.depth) &&
      (![moved.sensor, ...moved.lights].every(inside) ||
      !moved.doors.every(door => inside(door) && (door.x === x || door.x === x + width || door.z === z || door.z === z + depth))))
    return null;
  return moved;
}

export function initBuildingEditor({ onActivated = () => {}, mutationAccess } = {}) {
  const root = document.querySelector('#buildingEditor');
  const content = document.querySelector('#editorContent');
  const status = document.querySelector('#editorStatus');
  const error = document.querySelector('#editorError');
  error.tabIndex = -1;
  const openButton = document.querySelector('#openEditor');
  let session, floorIndex = 0, selected = null, tool = 'select', busy = false, heartbeat, opening = false;
  const forms = createFormGuard(content, () => confirm(t('editorUnapplied')), () => showStatus());

  const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const button = (label, action) => {
    const node = el('button', label);
    node.type = 'button';
    node.addEventListener('click', action);
    return node;
  };
  const report = message => { error.hidden = !message; error.textContent = message || ''; };
  const showStatus = () => {
    openButton.disabled = !mutationAccess?.editorAllowed || !root.hidden || opening;
    const accessStatus = document.querySelector('#editorAccessStatus');
    const accessMessage = mutationAccess?.editorMessage || t('mutationAccess_checking');
    if (accessStatus.textContent !== accessMessage) accessStatus.textContent = accessMessage;
    if (!session?.design) return;
    const state = session.conflict ? t('editorConflict') :
      session.dirty ? t('editorDirty') : t('editorSaved');
    const activation = session.activationStatus === 'active' ? t('editorActivationActive') :
      session.activationStatus === 'pending' ? t('editorActivationPending') :
      session.activationStatus === 'failed' ? t('editorActivationFailed') : displayStatus(session.activationStatus);
    const revisions = session.activeDesign ? t('editorRevisions', { saved: session.saved.revision, running: session.activeDesign.revision }) : '';
    const cleanup = Array.isArray(session.cleanup) ? t('editorCleanup', {
      pending: session.cleanup.filter(c => String(c.status).toLowerCase() === 'pending').length,
      failed: session.cleanup.filter(c => String(c.status).toLowerCase() === 'failed').length,
      completed: session.cleanup.filter(c => String(c.status).toLowerCase() === 'completed').length,
      cancelled: session.cleanup.filter(c => String(c.status).toLowerCase() === 'cancelled').length
    }) : t('editorCleanupUnavailable');
    const refreshError = session.statusError ? t('editorStatusRefreshFailed', { error: session.statusError }) : '';
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
    content.querySelectorAll('fieldset[data-edit]').forEach(fieldset => {
      fieldset.disabled = busy || session.conflict;
    });
    content.querySelectorAll('[data-recovery]').forEach(node => {
      node.hidden = !session.conflict;
    });
    content.querySelectorAll('[data-idle]').forEach(node => {
      const blocked = !mutationAccess?.editorAllowed ||
        (session.conflict && node.dataset.recovery !== 'conflict');
      node.disabled = busy || (node.dataset.write === 'true' && blocked) ||
        (node.dataset.history === 'undo' && !session.undoStack.length) ||
        (node.dataset.history === 'redo' && !session.redoStack.length);
    });
    content.querySelectorAll('form input, form select, form textarea, form button, [data-editor-mutation]').forEach(node => {
      node.disabled = busy || session.conflict || !mutationAccess?.editorAllowed;
    });
    content.querySelectorAll('[data-activation]').forEach(node => { node.hidden = !['pending', 'failed'].includes(session.activationStatus); });
    content.querySelectorAll('[data-cleanup]').forEach(node => {
      node.hidden = !session.cleanup?.some(c => ['pending', 'failed'].includes(String(c.status).toLowerCase()));
    });
  };
  const displayStatus = value => value == null ? t('editorUnknownStatus') :
    typeof value === 'string' ? value : JSON.stringify(value);
  const run = async action => {
    if (busy) return;
    busy = true;
    report('');
    showStatus();
    try { await action(); }
    catch (e) { report(e.message); }
    finally { busy = false; showStatus(); }
  };
  const refresh = () => { render(); showStatus(); };
  const apply = (change, except = null, confirmed = false) => {
    if (busy || !mutationAccess?.editorAllowed) return false;
    if (!confirmed && !forms.confirm(except)) return false;
    report(''); session.edit(change); refresh();
    return true;
  };
  const floor = () => session.design.floors[floorIndex];
  const locate = (design, selection = selected) => {
    const f = design.floors[floorIndex];
    if (!selection || !f) return {};
    if (selection.kind === 'controller') return { floor: f, item: f };
    const room = f.rooms.find(r => r.id === selection.roomId);
    if (!room) return {};
    if (selection.kind === 'room') return { floor: f, room, item: room };
    if (selection.kind === 'sensor') return { floor: f, room, item: room.sensor };
    return { floor: f, room, item: room[selection.kind === 'door' ? 'doors' : 'lights'].find(item => item.id === selection.id) };
  };
  const select = selection => {
    if (busy) return;
    if (!forms.confirm()) return;
    selected = selection; refresh();
  };
  const input = (form, label, name, value, options = {}) => {
    const wrapper = el('label', label);
    const field = el('input');
    field.name = name;
    field.type = 'text';
    field.value = value;
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
        field.dataset.min = options.min;
        field.setAttribute('aria-valuemin', options.min);
      }
      if (options.max !== undefined) {
        field.dataset.max = options.max;
        field.setAttribute('aria-valuemax', options.max);
      }
      field.dataset.step = options.step || '0.5';
      const constraints = { min: options.min, max: options.max, step: field.dataset.step };
      const updateAria = (raw, validation) => {
        const numeric = validation.value;
        if (Number.isFinite(numeric)) field.setAttribute('aria-valuenow', String(numeric));
        else field.removeAttribute('aria-valuenow');
        if (raw) field.setAttribute('aria-valuetext', raw);
        else field.removeAttribute('aria-valuetext');
        field.setAttribute('aria-invalid', String(!field.validity.valid));
      };
      const validate = () => {
        const raw = field.value.trim();
        const result = validateNumericInput(raw, constraints);
        field.setCustomValidity(['finite', 'range', 'step'].includes(result.reason) ? t('editorNumericConstraint') : '');
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
  const formButton = (form, label) => {
    const submit = el('button', label);
    submit.type = 'submit';
    form.append(submit);
  };
  const svg = (name, attributes) => {
    const node = document.createElementNS(svgNs, name);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    return node;
  };
  const renderPlan = parent => {
    const plan = svg('svg', { viewBox: `0 0 ${session.design.width} ${session.design.depth}`, role: 'img', 'aria-label': t('editorPlan') });
    plan.classList.add('editor-plan');
    const current = floor();
    const point = (x, z, kind, selection) => {
      const circle = svg('circle', { cx: x, cy: z, r: Math.max(session.design.width, session.design.depth) * .014, class: `editor-${kind}` });
      circle.addEventListener('click', event => { if (tool === 'select') { event.stopPropagation(); select(selection); } });
      plan.append(circle);
    };
    for (const room of current.rooms) {
      const rect = svg('rect', { x: room.x, y: room.z, width: room.width, height: room.depth, class: 'editor-room' });
      rect.addEventListener('click', event => { if (tool === 'select') { event.stopPropagation(); select({ kind: 'room', roomId: room.id }); } });
      plan.append(rect);
      const label = svg('text', { x: room.x + .3, y: room.z + .8, 'font-size': Math.max(.5, session.design.width / 45) });
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
      const x = snap(Math.max(0, Math.min(session.design.width, coords.x)));
      const z = snap(Math.max(0, Math.min(session.design.depth, coords.y)));
      if (tool === 'room') {
        apply(d => d.floors[floorIndex].rooms.push(newRoom(x, z, 2, 2, t('editorNewRoom'), d.floors[floorIndex].controllerId)));
      } else if (tool === 'move') {
        if (!locate(session.design).item) { report(t('editorNoMove')); return; }
        apply(d => {
          const found = locate(d);
          if (selected.kind === 'controller') { found.item.controllerX = x; found.item.controllerZ = z; }
          else if (selected.kind === 'room') Object.assign(found.room, reshapeRoom(found.room, x, z, found.room.width, found.room.depth));
          else { found.item.x = x; found.item.z = z; }
        });
      } else {
        if (!locate(session.design).room) { report(t('editorClickRoom')); return; }
        apply(d => {
          const found = locate(d);
          if (tool === 'door') found.room.doors.push({ id: newId('door'), x, z });
          else found.room.lights.push({ id: newId('light'), x, z, controllerId: found.floor.controllerId });
        });
      }
    });
    parent.append(plan);
  };

  const render = () => {
    if (!session?.design) return;
    floorIndex = Math.min(floorIndex, session.design.floors.length - 1);
    const active = content.contains(document.activeElement) ? document.activeElement : null;
    const focusText = active?.tagName === 'BUTTON' ? active.textContent : null;
    const focusKey = active?.dataset.focusKey;
    content.replaceChildren();
    const actions = el('div', undefined, 'editor-actions');
    const action = (label, fn, recovery) => {
      const b = button(label, fn);
      b.dataset.idle = '';
      if (recovery) b.dataset.recovery = recovery;
      actions.append(b);
      return b;
    };
    const focusProblem = (problem, formName) => {
      const field = problem?.field;
      const target = field && content.querySelector(`form[data-form="${formName}"] [name="${field}"]`);
      const currentContext = { floorIndex, selection: selected };
      const enabled = target && !target.matches(':disabled');
      if (canFocusValidationField(problem, currentContext, formName, enabled)) target.focus();
      else error.focus();
    };
    const saveButton = action(t('editorSave'), () => {
      const problem = locateValidation(session.design);
      if (problem) {
        const message = problem.floor === undefined ? t('editorValidationBuilding', { error: problem.error }) :
          t('editorValidationLocation', { floor: session.design.floors[problem.floor].number, item: problem.item, error: problem.error });
        if (forms.hasChanges()) {
          report(t('editorValidationUnapplied', { error: message }));
          error.focus();
          return;
        }
        if (problem.floor !== undefined) { floorIndex = problem.floor; selected = problem.selection; refresh(); }
        report(message);
        const formName = problem.floor === undefined ? 'building' : 'properties';
        focusProblem(problem, formName);
        return;
      }
      if (!forms.confirm()) return;
      void run(async () => {
      await session.save();
      await onActivated();
      refresh();
      });
    });
    saveButton.dataset.write = 'true';
    const retryActivation = action(t('editorRetryActivation'), () => run(async () => {
      await session.retryWork('/retry');
      await onActivated();
    }));
    retryActivation.dataset.write = 'true'; retryActivation.dataset.activation = '';
    const retryCleanup = action(t('editorRetryCleanup'), () => run(() => session.retryWork('/retry-cleanup')));
    retryCleanup.dataset.write = 'true'; retryCleanup.dataset.cleanup = '';
    const undo = action(t('editorUndo'), () => { if (forms.confirm()) { session.history(session.undoStack, session.redoStack); refresh(); } });
    undo.dataset.write = 'true'; undo.dataset.history = 'undo';
    const redo = action(t('editorRedo'), () => { if (forms.confirm()) { session.history(session.redoStack, session.undoStack); refresh(); } });
    redo.dataset.write = 'true'; redo.dataset.history = 'redo';
    action(t('editorUseCurrent'), () => {
      if (!confirm(t('editorUseCurrentConfirm'))) return;
      void run(async () => { await session.useCurrent(); selected = null; refresh(); });
    }, 'conflict').dataset.write = 'true';
    action(t('editorExport'), () => {
      const pendingForms = forms.pending();
      const download = (value, filename) => {
        const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = el('a'); link.href = url; link.download = filename; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 0);
      };
      const exportRecovery = (reason, issue) => {
        download(createRecoveryExport(session.design, pendingForms, {
          floorIndex,
          floorNumber: session.design.floors[floorIndex]?.number ?? null,
          selection: selected,
          conflict: Boolean(session.conflict),
          savedRevision: session.saved?.revision ?? null,
          editRevision: session.editRevision ?? null
        }, reason), 'building-design-recovery.json');
        report(t('editorRecoveryExported'));
        if (issue) focusProblem(issue, issue.form);
      };
      for (const pending of pendingForms) {
        const form = [...content.querySelectorAll('form')].find(candidate => candidate.dataset.form === pending.form);
        const invalid = form && [...form.querySelectorAll('input, select, textarea')].find(field => !field.checkValidity());
        if (invalid) {
          exportRecovery(invalid.validationMessage || t('editorPendingProjectionInvalid'), {
            form: pending.form,
            field: invalid.name
          });
          return;
        }
      }
      const projected = projectPendingForms(session.design, pendingForms, floorIndex, selected);
      if (projected.issue) {
        const problem = projected.issue.problem;
        const message = problem ? problem.floor === undefined ? t('editorValidationBuilding', { error: problem.error }) :
          t('editorValidationLocation', { floor: session.design.floors[problem.floor]?.number, item: problem.item, error: problem.error }) :
          projected.issue.form === 'properties' && projected.issue.field === 'width'
            ? t('editorResizeFixtures') : t('editorPendingProjectionInvalid');
        exportRecovery(message, projected.issue);
        return;
      }
      download(projected.design, 'building-design.json');
    });
    action(t('editorExit'), () => {
      void run(async () => {
      if ((forms.hasChanges() || session.dirty) && !confirm(t('editorExitConfirm'))) return;
      await close();
      });
    });
    content.append(actions, el('p', t('editorHistory'), 'editor-help'));

    const layout = el('div', undefined, 'editor-layout');
    const settings = el('fieldset'); settings.dataset.edit = '';
    settings.append(el('legend', t('editorBuilding')));
    const buildingForm = el('form');
    buildingForm.dataset.form = 'building';
    input(buildingForm, t('editorWidth'), 'width', session.design.width, { min: 2, max: 100 });
    input(buildingForm, t('editorDepth'), 'depth', session.design.depth, { min: 2, max: 100 });
    input(buildingForm, t('editorFloorCount'), 'count', session.design.floors.length, { min: 1, max: 10, step: 1 });
    formButton(buildingForm, t('editorApply'));
    buildingForm.addEventListener('submit', event => {
      event.preventDefault();
      const data = new FormData(buildingForm);
      const count = Number(data.get('count'));
      const removed = session.design.floors.slice(count);
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
    const floorSelect = el('select');
    floorSelect.dataset.focusKey = 'floor';
    session.design.floors.forEach((f, index) => {
      const option = el('option', t('editorFloor', { number: f.number }));
      option.value = index; option.selected = index === floorIndex; floorSelect.append(option);
    });
    floorSelect.addEventListener('change', () => {
      if (!forms.confirm()) { floorSelect.value = String(floorIndex); return; }
      floorIndex = Number(floorSelect.value); selected = null; refresh();
      content.querySelector('[data-focus-key="floor"]')?.focus({ preventScroll: true });
    });
    floorLabel.append(floorSelect); settings.append(floorLabel);
    layout.append(settings);

    const workspace = el('fieldset'); workspace.dataset.edit = '';
    workspace.append(el('legend', t('editorPlan')), el('p', t('editorPlanHelp'), 'editor-help'));
    const toolLabel = el('label', t('editorTool'));
    const toolSelect = el('select');
    toolSelect.dataset.editorMutation = '';
    toolSelect.dataset.focusKey = 'tool';
    for (const [value, key] of [['select', 'editorSelect'], ['room', 'editorAddRoom'], ['door', 'editorAddDoor'], ['light', 'editorAddLight'], ['move', 'editorMove']]) {
      const option = el('option', t(key)); option.value = value; option.selected = tool === value; toolSelect.append(option);
    }
    toolSelect.addEventListener('change', () => { tool = toolSelect.value; });
    toolLabel.append(toolSelect); workspace.append(toolLabel);
    renderPlan(workspace);
    layout.append(workspace);

    const properties = el('fieldset'); properties.dataset.edit = '';
    properties.append(el('legend', t('editorItems')));
    const list = el('div', undefined, 'editor-items');
    const itemButton = (label, selection) => {
      const b = button(label, () => select(selection));
      b.setAttribute('aria-pressed', String(JSON.stringify(selection) === JSON.stringify(selected)));
      list.append(b);
    };
    itemButton(t('editorController'), { kind: 'controller' });
    const currentFloor = floor();
    if (!currentFloor.rooms.length) list.append(el('p', t('editorNoRooms')));
    currentFloor.rooms.forEach(room => {
      itemButton(t('editorRoom', { name: room.name }), { kind: 'room', roomId: room.id });
      const connection = item => item.controllerId === currentFloor.controllerId ? t('editorConnected') : t('editorDisconnected');
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
    if (focusKey) content.querySelector(`[data-focus-key="${focusKey}"]`)?.focus({ preventScroll: true });
    else if (focusText) {
      const replacement = [...content.querySelectorAll('button')].find(node => node.textContent === focusText && !node.disabled);
      (replacement || root.querySelector('#editorHeading')).focus({ preventScroll: true });
    }
  };

  const renderProperties = parent => {
    const newForm = el('form');
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
    const found = locate(session.design);
    if (!found.item) return;
    const form = el('form');
    form.dataset.form = 'properties';
    form.append(el('h3', t('editorProperties')));
    if (selected.kind === 'room') input(form, t('editorName'), 'name', found.room.name, { text: true, maxLength: 256 });
    input(form, t('editorX'), 'x', selected.kind === 'controller' ? found.item.controllerX : found.item.x);
    input(form, t('editorZ'), 'z', selected.kind === 'controller' ? found.item.controllerZ : found.item.z);
    if (selected.kind === 'room') {
      input(form, t('editorRoomWidth'), 'width', found.room.width, { min: 1 });
      input(form, t('editorRoomDepth'), 'depth', found.room.depth, { min: 1 });
    }
    if (selected.kind === 'sensor' || selected.kind === 'light') {
      const label = el('label', t('editorConnection'));
      const selectConnection = el('select');
      selectConnection.name = 'connection';
      for (const [value, labelText] of [['', t('editorNoConnection')], [found.floor.controllerId, t('editorConnected')]]) {
        const option = el('option', labelText);
        option.value = value; option.selected = value === (found.item.controllerId || ''); selectConnection.append(option);
      }
      label.append(selectConnection); form.append(label);
    }
    formButton(form, t('editorApply'));
    form.addEventListener('submit', event => {
      event.preventDefault();
      const data = new FormData(form);
      const reshaped = selected.kind === 'room'
        ? reshapeRoom(found.room, Number(data.get('x')), Number(data.get('z')), Number(data.get('width')), Number(data.get('depth')))
        : null;
      if (selected.kind === 'room' && !reshaped) { report(t('editorResizeFixtures')); return; }
      apply(d => {
        const item = locate(d).item;
        if (selected.kind === 'controller') {
          item.controllerX = Number(data.get('x')); item.controllerZ = Number(data.get('z'));
        } else if (selected.kind !== 'room') {
          item.x = Number(data.get('x')); item.z = Number(data.get('z'));
        }
        if (selected.kind === 'room') {
          Object.assign(item, reshaped);
          item.name = String(data.get('name'));
        }
        if (selected.kind === 'sensor' || selected.kind === 'light') item.controllerId = data.get('connection') || null;
      }, form);
    });
    parent.append(form);
    if (found.room) {
      const addDoor = button(t('editorAddDoor'), () => apply(d => {
        const room = locate(d).room;
        room.doors.push({ id: newId('door'), x: room.x, z: room.z });
      }));
      const addLight = button(t('editorAddLight'), () => apply(d => {
        const { room, floor: f } = locate(d);
        room.lights.push({ id: newId('light'), x: room.x, z: room.z, controllerId: f.controllerId });
      }));
      parent.append(addDoor, addLight);
      addDoor.dataset.editorMutation = '';
      addLight.dataset.editorMutation = '';
    }
    if (selected.kind === 'room' || selected.kind === 'door' || selected.kind === 'light') {
      const remove = button(t('editorDelete'), () => {
        const message = selected.kind === 'room'
          ? t('editorRoomRemove', { room: found.room.name, doors: found.room.doors.length, lights: found.room.lights.length })
          : t('editorDeleteConfirm', { item: selected.kind === 'door' ? t('editorAddDoor') : t('editorAddLight') });
        if (!forms.confirm() || !confirm(message)) return;
        apply(d => {
          const current = locate(d);
          if (selected.kind === 'room') current.floor.rooms = current.floor.rooms.filter(r => r.id !== current.room.id);
          else {
            const key = selected.kind === 'door' ? 'doors' : 'lights';
            current.room[key] = current.room[key].filter(item => item.id !== selected.id);
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
    else document.querySelector('.editor-menu summary').focus();
  };

  const load = async () => {
    if (opening) return;
    if (!mutationAccess?.editorAllowed) { status.textContent = ''; report(mutationAccess?.editorMessage || t('mutationAccess_checking')); return; }
    opening = true;
    status.textContent = t('editorLoading');
    report('');
    content.replaceChildren();
    session = new EditorSession((url, options) => mutationAccess.request(url, options, true), showStatus);
    try {
      await session.open();
      floorIndex = 0; selected = null; tool = 'select';
      heartbeat = setInterval(() => { session?.refreshStatus(); }, 20000);
      refresh();
    } catch (e) {
      status.textContent = '';
      report(t('editorLoadFailed', { error: e.message }));
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
    root.querySelector('#editorHeading').focus();
    return load();
  };
  openButton.addEventListener('click', open);
  mutationAccess?.subscribe(() => {
    if (!mutationAccess.editorAllowed) {
      tool = 'select';
      const selector = content.querySelector('[data-focus-key="tool"]');
      if (selector) selector.value = tool;
    }
    showStatus();
    content.querySelectorAll('[data-editor-mutation]').forEach(node => {
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
