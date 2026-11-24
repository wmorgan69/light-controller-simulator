import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adjustNumericInput, canFocusValidationField, createFormGuard, createRecoveryExport, initBuildingEditor, locateValidation, projectPendingForms, reshapeRoom, sameEditorContext, unappliedFormStatus, validateNumericInput } from '../src/Devices.Simulator.Web/frontend/editor/building-editor.ts';
import { createMutationAccess } from '../src/Devices.Simulator.Web/frontend/shared/mutation-access.ts';
import { newFloor, newRoom } from '../src/Devices.Simulator.Web/frontend/editor/building-editor-state.ts';
import { t } from '../src/Devices.Simulator.Web/frontend/shared/localization.en.ts';

const form = (...fields) => ({ querySelectorAll: () => fields });

function createEditorDom() {
  const matchesPart = (node, selector) => {
    const tag = selector.match(/^[a-z]+/i)?.[0];
    if (tag && node.tagName !== tag.toUpperCase()) return false;
    return [...selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)].every(([, key, expected]) => {
      const value = key.startsWith('data-')
        ? node.dataset[key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())]
        : node[key];
      return value !== undefined && (expected === undefined || value === expected);
    });
  };
  const matches = (node, selector) => {
    const parts = selector.trim().split(/\s+/);
    if (!matchesPart(node, parts.pop())) return false;
    for (const part of parts.reverse()) {
      node = node.parent;
      while (node && !matchesPart(node, part)) node = node.parent;
      if (!node) return false;
    }
    return true;
  };
  const element = (tag = 'div') => {
    let value = '';
    return {
      tagName: tag.toUpperCase(), hidden: false, textContent: '', dataset: {}, children: [], listeners: {},
      classList: { add() {} }, validity: { valid: true },
      get value() { return value; }, set value(next) { value = String(next); },
      addEventListener(type, listener) { this.listeners[type] = listener; },
      setAttribute(key, value) { this[key] = String(value); },
      removeAttribute(key) { delete this[key]; },
      setCustomValidity(message) { this.validity.valid = !message; },
      querySelectorAll(selector) {
        const descendants = this.children.flatMap(child => [child, ...child.querySelectorAll('*')]);
        return descendants.filter(child => selector.split(',').some(part => matches(child, part)));
      },
      querySelector(selector) { return this.querySelectorAll(selector)[0]; },
      replaceChildren() { this.children = []; },
      append(...nodes) { nodes.forEach(node => { node.parent = this; this.children.push(node); }); },
      contains(node) { return this.querySelectorAll('*').includes(node); },
      focus() {}
    };
  };
  const elements = Object.fromEntries(['buildingEditor', 'editorContent', 'editorStatus', 'editorError', 'openEditor', 'editorAccessStatus']
    .map(id => [`#${id}`, element()]));
  elements['#buildingEditor'].hidden = true;
  elements['#buildingEditor'].append(element('h2'));
  return {
    elements,
    document: {
      activeElement: null,
      querySelector: selector => elements[selector],
      createElement: element,
      createElementNS: (_, tag) => element(tag)
    }
  };
}

test('revoking and restoring access in an open editor gates writes through navigation and rerenders', async () => {
  const dom = createEditorDom();
  const previous = {
    document: globalThis.document, window: globalThis.window,
    setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval
  };
  Object.assign(globalThis, {
    document: dom.document, window: { addEventListener() {} },
    setInterval: () => 1, clearInterval() {}
  });
  try {
    const floors = [newFloor(1), newFloor(2)];
    floors[0].rooms.push(newRoom(0, 0, 4, 4, 'Office', floors[0].controllerId));
    const design = { revision: 1, width: 20, depth: 20, floors };
    let allowed = true;
    const access = createMutationAccess(async url => url === '/api/capabilities'
      ? { ok: true, json: async () => ({ mutationsAllowed: allowed, editorAllowed: allowed }) }
      : { ok: true, status: 200, text: async () => JSON.stringify({
        design, activeDesign: design, editRevision: 0,
        activationStatus: 'active', cleanup: []
      }) });
    initBuildingEditor({ mutationAccess: access });
    await access.refresh();
    await dom.elements['#openEditor'].listeners.click();
    const content = dom.elements['#editorContent'];
    const button = label => content.querySelectorAll('button').find(node => node.textContent === t(label));
    assert.equal(button('editorSave').disabled, false);
    const toolSelect = content.querySelector('[data-focus-key="tool"]');
    toolSelect.value = 'room';
    toolSelect.listeners.change();
    allowed = false;
    await access.refresh();
    assert.equal(toolSelect.value, 'select');
    assert.match(dom.elements['#editorStatus'].textContent, /View-only/);
    assert.equal(button('editorSave').disabled, true);
    assert.ok(content.querySelectorAll('form input, form select, form button, [data-editor-mutation]').every(node => node.disabled));
    assert.equal(button('editorExport').disabled, false);
    assert.equal(button('editorExit').disabled, false);
    const floorSelect = content.querySelector('[data-focus-key="floor"]');
    assert.notEqual(floorSelect.disabled, true);
    floorSelect.value = '1';
    floorSelect.listeners.change();
    assert.ok(content.querySelectorAll('form input, form button, [data-editor-mutation]').every(node => node.disabled));
    assert.notEqual(button('editorController').disabled, true);
    button('editorController').listeners.click();
    assert.ok(content.querySelectorAll('form input').every(node => node.disabled));
    allowed = true;
    await access.refresh();
    assert.doesNotMatch(dom.elements['#editorStatus'].textContent, /View-only/);
    assert.equal(button('editorSave').disabled, false);
    assert.ok(content.querySelectorAll('form input').every(node => !node.disabled));
    assert.equal(button('editorUndo').disabled, true);
    assert.equal(dom.elements['#openEditor'].disabled, true);
    assert.equal(content.querySelector('[data-focus-key="tool"]').children.find(option => option.selected).value, 'select');
  } finally {
    Object.assign(globalThis, previous);
  }
});

test('exiting with applied and unapplied edits preserves them when cancelled', async () => {
  const dom = createEditorDom();
  const previous = {
    document: globalThis.document, window: globalThis.window, confirm: globalThis.confirm,
    setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval, FormData: globalThis.FormData
  };
  const listeners = {};
  let confirmed = false;
  const prompts = [];
  Object.assign(globalThis, {
    document: dom.document, window: { addEventListener(type, callback) { listeners[type] = callback; } },
    confirm: message => { prompts.push(message); return confirmed; }, setInterval: () => 1, clearInterval() {},
    FormData: class {
      constructor(form) { this.form = form; }
      get(name) { return this.form.querySelector(`[name="${name}"]`).value; }
    }
  });
  try {
    const design = { revision: 1, width: 20, depth: 20, floors: [newFloor(1)] };
    const access = createMutationAccess(async url => {
      if (url === '/api/capabilities')
        return { ok: true, json: async () => ({ mutationsAllowed: true, editorAllowed: true }) };
      return { ok: true, status: 200, text: async () => JSON.stringify({
        design, activeDesign: design, editRevision: 1, activationStatus: 'active', cleanup: []
      }) };
    });
    initBuildingEditor({ mutationAccess: access });
    await access.refresh();
    await dom.elements['#openEditor'].listeners.click();
    const content = dom.elements['#editorContent'];
    let width = content.querySelector('form[data-form="building"] input[name="width"]');
    width.value = '21';
    content.querySelector('form[data-form="building"]').listeners.submit({ preventDefault() {} });
    width = content.querySelector('form[data-form="building"] input[name="width"]');
    const unload = { preventDefault() { this.prevented = true; } };
    listeners.beforeunload(unload);
    assert.equal(unload.prevented, true);
    const exit = content.querySelectorAll('button').find(node => node.textContent === t('editorExit'));
    exit.listeners.click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(dom.elements['#buildingEditor'].hidden, false);
    assert.equal(width.value, '21');
    assert.deepEqual(prompts, [t('editorExitConfirm')]);
    prompts.length = 0;
    width.value = '22';
    exit.listeners.click();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(prompts, [t('editorExitConfirm')]);
    assert.equal(width.value, '22');
    confirmed = true;
    exit.listeners.click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(dom.elements['#buildingEditor'].hidden, true);
  } finally {
    Object.assign(globalThis, previous);
  }
});

test('conflict recovery becomes usable when control access returns', async () => {
  const dom = createEditorDom();
  const previous = {
    document: globalThis.document, window: globalThis.window, confirm: globalThis.confirm,
    setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval
  };
  Object.assign(globalThis, {
    document: dom.document, window: { addEventListener() {} }, confirm: () => true,
    setInterval: () => 1, clearInterval() {}
  });
  try {
    let allowed = true;
    let design = { revision: 1, width: 20, depth: 20, floors: [newFloor(1)] };
    let editRevision = 0;
    const access = createMutationAccess(async url => {
      if (url === '/api/capabilities')
        return { ok: true, json: async () => ({ mutationsAllowed: allowed, editorAllowed: allowed }) };
      if (url.endsWith('/save'))
        return { ok: false, status: 409, text: async () => '{"detail":"The design revision changed."}' };
      return { ok: true, status: 200, text: async () => JSON.stringify({
        design, activeDesign: design, editRevision,
        activationStatus: 'active', cleanup: []
      }) };
    });
    initBuildingEditor({ mutationAccess: access });
    await access.refresh();
    await dom.elements['#openEditor'].listeners.click();
    const content = dom.elements['#editorContent'];
    const button = label => content.querySelectorAll('button').find(node => node.textContent === t(label));
    button('editorSave').listeners.click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(button('editorUseCurrent').hidden, false);
    allowed = false;
    await access.refresh();
    assert.equal(button('editorUseCurrent').disabled, true);
    allowed = true;
    await access.refresh();
    design = { ...design, revision: 2, width: 22 };
    editRevision = 1;
    assert.equal(button('editorUseCurrent').hidden, false);
    assert.equal(button('editorUseCurrent').disabled, false);
    assert.equal(button('editorSave').disabled, true);
    allowed = false;
    await access.refresh();
    assert.equal(button('editorUseCurrent').disabled, true);
    allowed = true;
    await access.refresh();
    assert.equal(button('editorUseCurrent').disabled, false);
    button('editorUseCurrent').listeners.click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(content.querySelector('form[data-form="building"] input[name="width"]').value, '22');
    assert.equal(button('editorUseCurrent').hidden, true);
    assert.equal(button('editorSave').disabled, false);
  } finally {
    Object.assign(globalThis, previous);
  }
});

test('conflict recovery handles failed state fetch without losing local edits', async () => {
  const dom = createEditorDom();
  const previous = {
    document: globalThis.document, window: globalThis.window, confirm: globalThis.confirm,
    setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval
  };
  Object.assign(globalThis, {
    document: dom.document, window: { addEventListener() {} }, confirm: () => true,
    setInterval: () => 1, clearInterval() {}
  });
  try {
    let allowed = true, stateUnavailable = false;
    let design = { revision: 1, width: 20, depth: 20, floors: [newFloor(1)] };
    let editRevision = 0;
    const access = createMutationAccess(async url => {
      if (url === '/api/capabilities')
        return { ok: true, json: async () => ({ mutationsAllowed: allowed, editorAllowed: allowed }) };
      if (url.endsWith('/save')) {
        stateUnavailable = true;
        return { ok: false, status: 409, text: async () => '{"detail":"The design revision changed."}' };
      }
      if (stateUnavailable)
        return { ok: false, status: 503, text: async () => '{"detail":"Editor state is unavailable."}' };
      return { ok: true, status: 200, text: async () => JSON.stringify({
        design, activeDesign: design, editRevision,
        activationStatus: 'active', cleanup: []
      }) };
    });
    initBuildingEditor({ mutationAccess: access });
    await access.refresh();
    await dom.elements['#openEditor'].listeners.click();
    const content = dom.elements['#editorContent'];
    const button = label => content.querySelectorAll('button').find(node => node.textContent === t(label));
    button('editorSave').listeners.click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(button('editorUseCurrent').hidden, false);
    assert.equal(button('editorUseCurrent').disabled, false);
    assert.equal(button('editorSave').disabled, true);
    button('editorUseCurrent').listeners.click();
    await new Promise(resolve => setImmediate(resolve));
    assert.match(dom.elements['#editorError'].textContent, /unavailable/);
    assert.equal(button('editorUseCurrent').hidden, false);
    allowed = false;
    await access.refresh();
    assert.equal(button('editorUseCurrent').disabled, true);
    allowed = true;
    await access.refresh();
    assert.equal(button('editorUseCurrent').disabled, false);
    stateUnavailable = false;
    design = { ...design, revision: 2, width: 22 };
    editRevision = 1;
    assert.ok(dom.elements['#editorStatus'].textContent.includes(t('editorConflict')));
    button('editorUseCurrent').listeners.click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(content.querySelector('form[data-form="building"] input[name="width"]').value, '22');
    assert.equal(button('editorUseCurrent').hidden, true);
    assert.equal(button('editorSave').disabled, false);
    assert.ok(!dom.elements['#editorStatus'].textContent.includes(t('editorConflict')));
  } finally {
    Object.assign(globalThis, previous);
  }
});

test('editor load failure clears loading status, shows readable details, and keeps return available', async () => {
  const element = () => ({
    hidden: true, textContent: '', dataset: {}, children: [], listeners: {},
    addEventListener(type, listener) { this.listeners[type] = listener; },
    querySelectorAll() { return this.children.filter(child => child.dataset.editorMutation !== undefined); },
    querySelector() { return null; },
    replaceChildren() { this.children = []; },
    append(...nodes) { this.children.push(...nodes); },
    focus() {}
  });
  const elements = Object.fromEntries(['buildingEditor', 'editorContent', 'editorStatus', 'editorError', 'openEditor', 'editorAccessStatus']
    .map(id => [`#${id}`, element()]));
  elements['#buildingEditor'].querySelector = () => element();
  elements['.editor-menu summary'] = element();
  const previousDocument = globalThis.document, previousWindow = globalThis.window;
  globalThis.document = { querySelector: selector => elements[selector], createElement: element };
  globalThis.window = { addEventListener() {} };
  try {
    const access = createMutationAccess(async url => url === '/api/capabilities'
      ? { ok: true, json: async () => ({ mutationsAllowed: true, editorAllowed: true }) }
      : { ok: false, status: 503, text: async () => '{"title":"Unavailable","detail":"Editor storage is unavailable."}' });
    initBuildingEditor({ mutationAccess: access });
    assert.equal(elements['#openEditor'].disabled, true);
    await access.refresh();
    assert.equal(elements['#openEditor'].disabled, false);
    await elements['#openEditor'].listeners.click();
    assert.equal(elements['#editorStatus'].textContent, '');
    assert.match(elements['#editorError'].textContent, /Editor storage is unavailable/);
    assert.doesNotMatch(elements['#editorError'].textContent, /"detail"/);
    const [retry, back] = elements['#editorContent'].children;
    assert.equal(retry.disabled, false);
    access.invalidate();
    assert.equal(retry.disabled, true);
    assert.notEqual(back.disabled, true);
    await back.listeners.click();
    assert.equal(elements['#buildingEditor'].hidden, true);
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

test('unapplied changes survive cancellation and are explicitly discarded on confirmation', () => {
  const name = { type: 'text', value: 'Office' };
  const x = { type: 'number', value: '2' };
  const first = form(name), second = form(x);
  let accept = false, prompts = 0;
  const guard = createFormGuard({ querySelectorAll: () => [first, second] }, () => { prompts++; return accept; });
  guard.track(first); guard.track(second);
  name.value = 'Changed'; x.value = '3';
  assert.equal(guard.confirm(), false);
  assert.equal(name.value, 'Changed');
  assert.equal(x.value, '3');
  accept = true;
  assert.equal(guard.confirm(first), true);
  assert.equal(name.value, 'Changed');
  assert.equal(x.value, '2');
  assert.equal(guard.hasChanges(), true);
  assert.equal(guard.confirm(), true);
  assert.equal(name.value, 'Office');
  assert.equal(guard.hasChanges(), false);
  assert.equal(prompts, 3);
});

test('form values can be restored after the editor rebuilds its forms', () => {
  const firstBuildingWidth = { name: 'width', type: 'text', value: '20' };
  const building = { dataset: { form: 'building' }, querySelectorAll: () => [firstBuildingWidth] };
  const firstName = { name: 'name', type: 'text', value: 'Office' };
  const firstWidth = { name: 'width', type: 'text', value: '2' };
  const first = { dataset: { form: 'properties' }, querySelectorAll: () => [firstName, firstWidth] };
  let current = [building, first];
  const guard = createFormGuard({ querySelectorAll: () => current }, () => false);
  guard.track(building);
  guard.track(first);
  firstName.value = 'Changed';
  firstWidth.value = '1e';
  const snapshot = guard.capture();
  assert.deepEqual(snapshot.map(form => form.form), ['properties']);

  const restoredBuildingWidth = { name: 'width', type: 'text', value: '24' };
  const restoredBuilding = { dataset: { form: 'building' }, querySelectorAll: () => [restoredBuildingWidth] };
  const restoredName = { name: 'name', type: 'text', value: 'Office' };
  const restoredWidth = { name: 'width', type: 'text', value: '2' };
  const replacement = { dataset: { form: 'properties' }, querySelectorAll: () => [restoredName, restoredWidth] };
  current = [restoredBuilding, replacement];
  guard.track(restoredBuilding);
  guard.track(replacement);
  guard.restore(snapshot);

  assert.equal(restoredBuildingWidth.value, '24');
  assert.equal(restoredName.value, 'Changed');
  assert.equal(restoredWidth.value, '1e');
  assert.equal(guard.hasChanges(), true);
  assert.deepEqual(guard.pending().map(form => form.form), ['properties']);
});

test('form edits update unapplied status immediately and preserve incomplete numeric text', () => {
  const name = { name: 'name', type: 'text', value: 'Office' };
  const coordinate = { name: 'x', type: 'text', value: '1' };
  const properties = { dataset: { form: 'properties' }, querySelectorAll: () => [name, coordinate] };
  const listeners = {};
  const content = {
    querySelectorAll: () => [properties],
    addEventListener: (type, listener) => { listeners[type] = listener; }
  };
  let guard;
  let status = '';
  guard = createFormGuard(content, () => false, () => { status = unappliedFormStatus(guard.hasChanges()); });
  guard.track(properties);

  coordinate.value = '1e';
  listeners.input();
  assert.equal(status, t('editorUnappliedFormStatus'));
  assert.equal(guard.pending()[0].fields.find(field => field.name === 'x').value, '1e');

  coordinate.value = '1';
  listeners.input();
  assert.equal(status, '');
});

test('form context matches only the original floor and selection', () => {
  const original = { floorIndex: 1, selection: { kind: 'room', roomId: 'room-a' } };
  assert.equal(sameEditorContext({ floorIndex: 1, selection: { kind: 'room', roomId: 'room-a' } }, original), true);
  assert.equal(sameEditorContext({ floorIndex: 1, selection: { kind: 'room', roomId: 'room-b' } }, original), false);
  assert.equal(sameEditorContext({ floorIndex: 0, selection: { kind: 'room', roomId: 'room-a' } }, original), false);
});

test('validation fields receive focus only when enabled and in the matching editor context', () => {
  const context = { floorIndex: 1, selection: { kind: 'room', roomId: 'room-a' } };
  const problem = { floor: 1, selection: { kind: 'room', roomId: 'room-a' }, field: 'x' };
  assert.equal(canFocusValidationField(problem, context, 'properties', true), true);
  assert.equal(canFocusValidationField(problem, context, 'properties', false), false);
  assert.equal(canFocusValidationField({ ...problem, floor: 0 }, context, 'properties', true), false);
  assert.equal(canFocusValidationField(problem, context, 'building', true), false);
  assert.equal(canFocusValidationField({ ...problem, selection: { kind: 'room', roomId: 'room-b' } }, context, 'properties', true), false);
  assert.equal(canFocusValidationField({ ...problem, selection: { kind: 'room', roomId: 'new-room' } }, context, 'new-room', true), true);
});

test('custom numeric validation handles incomplete text, valid values, and range/step boundaries', () => {
  const options = { min: 2, max: 100, step: 0.5 };
  assert.deepEqual(validateNumericInput('1e', options), { valid: false, reason: 'syntax' });
  assert.deepEqual(validateNumericInput('2e1', options), { valid: true, value: 20 });
  assert.deepEqual(validateNumericInput('2', options), { valid: true, value: 2 });
  assert.deepEqual(validateNumericInput('100', options), { valid: true, value: 100 });
  assert.deepEqual(validateNumericInput('1.5', options), { valid: false, reason: 'range', value: 1.5 });
  assert.deepEqual(validateNumericInput('100.5', options), { valid: false, reason: 'range', value: 100.5 });
  assert.deepEqual(validateNumericInput('2.25', options), { valid: false, reason: 'step', value: 2.25 });
});

test('numeric arrow adjustment honors step alignment and range limits', () => {
  const options = { min: 2, max: 3, step: 0.5 };
  assert.equal(adjustNumericInput('2', 'ArrowUp', options), '2.5');
  assert.equal(adjustNumericInput('3', 'ArrowUp', options), '3');
  assert.equal(adjustNumericInput('2', 'ArrowDown', options), '2');
  assert.equal(adjustNumericInput('2.25', 'ArrowUp', options), '2.5');
  assert.equal(adjustNumericInput('2.25', 'ArrowDown', options), '2');
  assert.equal(adjustNumericInput('', 'ArrowUp', options), '2');
  assert.equal(adjustNumericInput('1e', 'ArrowUp', options), null);
  assert.equal(adjustNumericInput('2', 'Enter', options), null);
});

test('moving a room translates all its fixtures without changing identities or wiring', () => {
  const floor = newFloor(1);
  const room = newRoom(2, 3, 4, 4, 'Office', floor.controllerId);
  room.sensor.x = 3; room.sensor.z = 4;
  room.doors.push({ id: 'door', x: 6, z: 5 });
  room.lights.push({ id: 'light', x: 4, z: 6, controllerId: floor.controllerId });
  const moved = reshapeRoom(room, 5, 1, 4, 4);
  assert.deepEqual([moved.sensor.x, moved.sensor.z], [6, 2]);
  assert.deepEqual([moved.doors[0].x, moved.doors[0].z], [9, 3]);
  assert.deepEqual([moved.lights[0].x, moved.lights[0].z], [7, 4]);
  assert.equal(moved.lights[0].id, 'light');
  assert.equal(moved.lights[0].controllerId, floor.controllerId);
  assert.deepEqual([room.x, room.z], [2, 3]);
});

test('rejects resizing past fixtures or away from doors without modifying the room', () => {
  const floor = newFloor(1);
  const room = newRoom(0, 0, 4, 4, 'Office', floor.controllerId);
  room.sensor.x = 3;
  room.doors.push({ id: 'door', x: 4, z: 2 });
  assert.equal(reshapeRoom(room, 0, 0, 2, 4), null);
  assert.equal(reshapeRoom(room, 0, 0, 5, 4), null);
  assert.equal(room.width, 4);
  room.doors[0].x = 0;
  assert.equal(reshapeRoom(room, 0, 0, 5, 4).width, 5);
});

test('locates invalid items on the affected floor and their correction field', () => {
  const floors = [newFloor(1), newFloor(2)];
  const room = newRoom(0, 0, 4, 4, 'Office', floors[1].controllerId);
  floors[1].rooms.push(room);
  room.sensor.controllerId = null;
  const problem = locateValidation({ revision: 1, width: 20, depth: 20, floors });
  assert.equal(problem.floor, 1);
  assert.equal(problem.selection.kind, 'sensor');
  assert.equal(problem.selection.roomId, room.id);
  assert.equal(problem.field, 'connection');
  assert.match(problem.error, /connect/i);
});

test('locates invalid Z coordinates and room dimensions at their correction fields', () => {
  const floor = newFloor(1);
  const room = newRoom(0, 0, 4, 4, 'Office', floor.controllerId);
  floor.rooms.push(room);
  const design = { revision: 1, width: 20, depth: 20, floors: [floor] };

  room.sensor.z = 5;
  assert.equal(locateValidation(design).field, 'z');
  room.sensor.z = 0;
  floor.controllerZ = 21;
  assert.equal(locateValidation(design).field, 'z');
  floor.controllerZ = 0;
  room.z = -0.5;
  assert.equal(locateValidation(design).field, 'z');
  room.z = 0;
  room.width = 0.5;
  assert.equal(locateValidation(design).field, 'width');
  room.width = 4;
  room.depth = 0.5;
  assert.equal(locateValidation(design).field, 'depth');
});

test('locates invalid access coordinates, dimensions, and stair direction', () => {
  const floors = [newFloor(1), newFloor(2)];
  const stair = { id: 'stair', x: 0, z: 0, width: 2, depth: 1, direction: 'east' };
  floors[0].stairs.push(stair);
  const design = { revision: 1, width: 20, depth: 20, floors };
  for (const [field, value] of [
    ['x', -5], ['z', 24], ['width', 25], ['depth', 0], ['direction', 'north']
  ]) {
    const previous = stair[field];
    stair[field] = value;
    const problem = locateValidation(design);
    assert.equal(problem.field, field);
    assert.deepEqual(problem.selection, { kind: 'stair', id: 'stair' });
    stair[field] = previous;
  }
});

test('room origins at or beyond the building bounds focus their coordinate fields', () => {
  const floor = newFloor(1);
  const room = newRoom(0, 0, 2, 2, 'Office', floor.controllerId);
  floor.rooms.push(room);
  const design = { revision: 1, width: 20, depth: 20, floors: [floor] };

  room.x = 21;
  assert.equal(locateValidation(design).field, 'x');
  room.x = 20;
  assert.equal(locateValidation(design).field, 'x');
  room.x = 19.5;
  assert.equal(locateValidation(design).field, 'x');
  room.x = 0;
  room.z = 21;
  assert.equal(locateValidation(design).field, 'z');
  room.z = 20;
  assert.equal(locateValidation(design).field, 'z');
  room.z = 19.5;
  assert.equal(locateValidation(design).field, 'z');
  room.z = 0;
  room.x = 19.5;
  room.width = 0.5;
  assert.equal(locateValidation(design).field, 'width');
  room.x = 0;
  room.width = 2;
  room.z = 19.5;
  room.depth = 0.5;
  assert.equal(locateValidation(design).field, 'depth');
});

test('projects pending form values for export without changing the editable design', () => {
  const floor = newFloor(1);
  const room = newRoom(0, 0, 4, 4, 'Office', floor.controllerId);
  floor.rooms.push(room);
  const design = { revision: 1, width: 20, depth: 20, floors: [floor] };
  const pending = [{
    form: 'properties',
    fields: [
      { name: 'name', type: 'text', value: 'Studio' },
      { name: 'x', type: 'number', value: '1' },
      { name: 'z', type: 'number', value: '1' },
      { name: 'width', type: 'number', value: '4' },
      { name: 'depth', type: 'number', value: '4' }
    ]
  }];
  const projected = projectPendingForms(design, pending, 0, { kind: 'room', roomId: room.id });

  assert.equal(projected.issue, null);
  assert.equal(projected.design.floors[0].rooms[0].name, 'Studio');
  assert.deepEqual([projected.design.floors[0].rooms[0].x, projected.design.floors[0].rooms[0].z], [1, 1]);
  assert.equal(locateValidation(projected.design), null);
  assert.equal(room.name, 'Office');
  assert.deepEqual([room.x, room.z], [0, 0]);

  const invalid = projectPendingForms(design, [{
    form: 'properties',
    fields: [
      { name: 'name', type: 'text', value: 'Studio' },
      { name: 'x', type: 'number', value: '1' },
      { name: 'z', type: 'number', value: '1' },
      { name: 'width', type: 'number', value: '0.5' },
      { name: 'depth', type: 'number', value: '4' }
    ]
  }], 0, { kind: 'room', roomId: room.id });
  assert.equal(invalid.design, null);
  assert.equal(invalid.issue.form, 'properties');
  assert.equal(invalid.issue.field, 'width');
  assert.equal(room.width, 4);
});

test('projects pending building and add-room fields into the exported design', () => {
  const floor = newFloor(1);
  const design = { revision: 1, width: 20, depth: 20, floors: [floor] };
  const projected = projectPendingForms(design, [
    { form: 'building', fields: [
      { name: 'width', type: 'number', value: '24' },
      { name: 'depth', type: 'number', value: '22' },
      { name: 'count', type: 'number', value: '1' }
    ] },
    { form: 'new-room', fields: [
      { name: 'name', type: 'text', value: 'Studio' },
      { name: 'x', type: 'number', value: '4' },
      { name: 'z', type: 'number', value: '0.5' },
      { name: 'width', type: 'number', value: '2' },
      { name: 'depth', type: 'number', value: '2' }
    ] }
  ], 0, null);

  assert.equal(projected.issue, null);
  assert.equal(projected.design.width, 24);
  assert.equal(projected.design.depth, 22);
  assert.equal(projected.design.floors[0].rooms[0].name, 'Studio');
  assert.equal(projected.design.floors[0].rooms[0].z, 0.5);
  assert.equal(design.width, 20);
  assert.equal(design.floors[0].rooms.length, 0);
});

test('invalid existing rooms do not focus an unrelated pending new-room form', () => {
  const floor = newFloor(1);
  const room = newRoom(0, 0, 0.5, 2, 'Office', floor.controllerId);
  floor.rooms.push(room);
  const design = { revision: 1, width: 20, depth: 20, floors: [floor] };
  const projected = projectPendingForms(design, [{
    form: 'new-room',
    fields: [
      { name: 'name', type: 'text', value: 'Studio' },
      { name: 'x', type: 'text', value: '4' },
      { name: 'z', type: 'text', value: '0' },
      { name: 'width', type: 'text', value: '2' },
      { name: 'depth', type: 'text', value: '2' }
    ]
  }], 0, null);
  assert.equal(projected.design, null);
  assert.equal(projected.issue.form, null);
  assert.equal(projected.issue.problem.selection.roomId, room.id);
});

test('rejects invalid building dimensions and floor counts before changing floor arrays', () => {
  const design = { revision: 1, width: 20, depth: 20, floors: [newFloor(1)] };
  for (const [field, value] of [['width', '1e100'], ['depth', ''], ['count', '1000000000']]) {
    const pending = [{
      form: 'building',
      fields: [
        { name: 'width', type: 'number', value: field === 'width' ? value : '20' },
        { name: 'depth', type: 'number', value: field === 'depth' ? value : '20' },
        { name: 'count', type: 'number', value: field === 'count' ? value : '1' }
      ]
    }];
    const result = projectPendingForms(design, pending, 0, null);
    assert.equal(result.design, null);
    assert.deepEqual(result.issue, { form: 'building', field });
  }
  assert.equal(design.floors.length, 1);
});

test('pending projection rejects incomplete numeric text and overlong room names', () => {
  const floor = newFloor(1);
  const design = { revision: 1, width: 20, depth: 20, floors: [floor] };
  const validExponent = projectPendingForms(design, [{
    form: 'building',
    fields: [
      { name: 'width', type: 'text', value: '2e1' },
      { name: 'depth', type: 'text', value: '2e1' },
      { name: 'count', type: 'text', value: '1' }
    ]
  }], 0, null);
  assert.equal(validExponent.issue, null);

  const incompleteCoordinate = projectPendingForms(design, [{
    form: 'new-room',
    fields: [
      { name: 'name', type: 'text', value: 'Office' },
      { name: 'x', type: 'text', value: '1e' },
      { name: 'z', type: 'text', value: '0' },
      { name: 'width', type: 'text', value: '2' },
      { name: 'depth', type: 'text', value: '2' }
    ]
  }], 0, null);
  assert.deepEqual(incompleteCoordinate.issue, { form: 'new-room', field: 'x' });
  assert.equal(incompleteCoordinate.design, null);

  const overlongName = projectPendingForms(design, [{
    form: 'new-room',
    fields: [
      { name: 'name', type: 'text', value: 'R'.repeat(257) },
      { name: 'x', type: 'text', value: '4' },
      { name: 'z', type: 'text', value: '0' },
      { name: 'width', type: 'text', value: '2' },
      { name: 'depth', type: 'text', value: '2' }
    ]
  }], 0, null);
  assert.equal(overlongName.design, null);
  assert.equal(overlongName.issue.form, 'new-room');
  assert.equal(overlongName.issue.field, 'name');
  assert.equal(overlongName.issue.problem.error, t('editorRoomNameTooLong'));
});

test('recovery export labels itself unvalidated and retains the unchanged design and raw form context', () => {
  const floor = newFloor(1);
  const design = { revision: 1, width: 20, depth: 20, floors: [floor] };
  const pending = [{
    form: 'building',
    fields: [
      { name: 'width', type: 'number', value: '1e100' },
      { name: 'depth', type: 'number', value: '20' },
      { name: 'count', type: 'number', value: '1' }
    ]
  }];
  const context = { floorIndex: 0, selection: { kind: 'controller' }, conflict: false };
  const recovery = createRecoveryExport(design, pending, context, 'Invalid width');

  assert.equal(recovery.format, 'building-editor-recovery');
  assert.equal(recovery.formatVersion, 1);
  assert.equal(recovery.validatedDesign, false);
  assert.equal(recovery.projection, 'not-applied');
  assert.deepEqual(recovery.design, design);
  assert.deepEqual(recovery.pendingForms, pending);
  assert.deepEqual(recovery.context, context);
  assert.equal(recovery.pendingForms[0].fields[0].value, '1e100');
  assert.equal(design.width, 20);
});
