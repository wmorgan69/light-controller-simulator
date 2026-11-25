import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { controllerStatusLabel, localizeMarkup, plural, t } from '../src/Devices.BuildingControl.Web/frontend/shared/localization.en.ts';
import { createMutationAccess, responseDetail, syncMutationControls } from '../src/Devices.BuildingControl.Web/frontend/shared/mutation-access.ts';

test('looks up English labels and interpolates dynamic values without changing their text', () => {
  assert.equal(t('pageTitle'), 'Building Control (Simulation)');
  assert.equal(t('floorRoomName', { floor: 3, room: 'Collaboration Space' }), 'Floor 3 — Collaboration Space');
  assert.equal(t('requestFailed', { status: 409, body: 'Room sensor has an active fault.' }),
    'Request failed (409): Room sensor has an active fault.');
});

test('uses English singular and plural forms', () => {
  assert.equal(plural('roomCount', 1), '1 room');
  assert.equal(plural('roomCount', 0), '0 rooms');
  assert.equal(plural('roomCount', 2), '2 rooms');
});

test('backs every static markup localization reference with a resource entry', async () => {
  const markup = await readFile(new URL('../src/Devices.BuildingControl.Web/wwwroot/index.html', import.meta.url), 'utf8');
  const keys = [...markup.matchAll(/\bdata-i18n(?:-aria-label|-title)?="([^"]+)"/g)].map(([, key]) => key);
  assert.ok(keys.length > 0);
  for (const key of keys) assert.equal(typeof t(key), 'string', `missing markup resource: ${key}`);
});

test('startup and no-script fallbacks match the English resources', async () => {
  const markup = await readFile(new URL('../src/Devices.BuildingControl.Web/wwwroot/index.html', import.meta.url), 'utf8');
  const title = markup.match(/<title[^>]*data-i18n="pageTitle"[^>]*>([^<]+)<\/title>/);
  assert.ok(title, 'missing page title fallback');
  assert.equal(title[1], t('pageTitle'));
  for (const key of ['appInitializing', 'appJavaScriptRequired']) {
    const match = markup.match(new RegExp(`<p[^>]*data-i18n="${key}"[^>]*>([^<]+)</p>`));
    assert.ok(match, `missing ${key} fallback`);
    assert.equal(match[1], t(key));
  }
  assert.match(markup, /<noscript>[\s\S]*data-i18n="appJavaScriptRequired"[\s\S]*<\/noscript>/);
});

test('backs every statically referenced browser message with a resource entry', async () => {
  const sources = await Promise.all([
    readFile(new URL('../src/Devices.BuildingControl.Web/frontend/SimulatorApp.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/Devices.BuildingControl.Web/frontend/scene/SceneCanvas.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/Devices.BuildingControl.Web/frontend/shared/simulator-model.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/Devices.BuildingControl.Web/frontend/editor/BuildingEditor.tsx', import.meta.url), 'utf8')
  ]);
  const keys = sources.flatMap(source => [...source.matchAll(/\bt\('([^']+)'/g)].map(([, key]) => key));
  const values = new Proxy({}, {
    get: () => 'value',
    getOwnPropertyDescriptor: () => ({ configurable: true, enumerable: true, value: 'value', writable: true })
  });
  assert.ok(keys.length > 0);
  for (const key of keys) {
    assert.doesNotThrow(() => t(key, values), `missing browser resource: ${key}`);
  }
});

test('keeps known controller status labels unchanged', () => {
  assert.equal(t('healthyStatus'), 'Healthy');
  assert.equal(t('faultedStatus'), 'Faulted');
  assert.equal(t('offlineStatus'), 'Offline');
  assert.equal(controllerStatusLabel('Healthy'), 'Healthy');
  assert.equal(controllerStatusLabel('Faulted'), 'Faulted');
  assert.equal(controllerStatusLabel('Offline'), 'Offline');
  assert.equal(controllerStatusLabel('FutureStatus'), 'FutureStatus');
});

test('localizes markup text, accessible labels, and titles without dropping fallbacks', () => {
  const textElement = { dataset: { i18n: 'pageTitle' }, textContent: 'fallback' };
  const ariaElement = {
    dataset: { i18nAriaLabel: 'buildingFloors' },
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; }
  };
  const titleElement = {
    dataset: { i18nTitle: 'occupancyDemoTitle' },
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; }
  };
  const elements = {
    '[data-i18n]': [textElement],
    '[data-i18n-aria-label]': [ariaElement],
    '[data-i18n-title]': [titleElement]
  };
  localizeMarkup({ querySelectorAll: selector => elements[selector] });
  assert.equal(textElement.textContent, 'Building Control (Simulation)');
  assert.equal(ariaElement.attributes['aria-label'], 'Building floors');
  assert.equal(titleElement.attributes.title, 'Randomly occupy up to 2 rooms on each floor');
});

test('keeps browser-generated fault descriptions exact while interpolating the unchanged scope', () => {
  assert.equal(t('simulatedSensorFault'), 'Simulated sensor fault');
  assert.equal(t('simulatedScopedFault', { scope: 'light' }), 'Simulated light fault');
});

test('fails explicitly for unknown keys, invalid plural resources and missing values', () => {
  assert.throws(() => t('missingLabel'), /Missing English localization key: missingLabel/);
  assert.throws(() => t('floorName'), /Missing interpolation value "floor"/);
  assert.throws(() => plural('pageTitle', 1), /does not define plural forms/);
  assert.throws(() => plural('roomCount', Number.NaN), /finite number/);
});

test('control access fails closed, distinguishes view-only and editor restrictions, and recovers', async () => {
  let result = { mutationsAllowed: false, editorAllowed: false };
  let fail = false;
  const calls = [];
  const access = createMutationAccess(async (url, options) => {
    calls.push({ url, options });
    if (fail) throw new Error('Offline');
    return { ok: true, json: async () => result };
  });
  assert.equal(access.allowed, false);
  assert.match(access.message, /Checking/);
  await assert.rejects(access.request('/api/scenarios/reset', { method: 'POST' }), /disabled/);
  assert.equal(calls.length, 0);
  await access.refresh();
  assert.match(access.message, /View-only/);
  result = { mutationsAllowed: true, editorAllowed: false };
  await access.refresh();
  assert.equal(access.allowed, true);
  assert.equal(access.editorAllowed, false);
  assert.match(access.editorMessage, /loopback development/);
  await assert.rejects(access.request('/api/building-editor/save', { method: 'POST' }, true), /unavailable/);
  result.editorAllowed = true;
  await access.refresh();
  assert.equal(access.editorAllowed, true);
  fail = true;
  await access.refresh();
  assert.equal(access.allowed, false);
  assert.match(access.message, /unavailable/);
  fail = false;
  result = { mutationsAllowed: 'true', editorAllowed: true };
  await access.refresh();
  assert.equal(access.allowed, false);
  result.mutationsAllowed = true;
  await access.refresh();
  assert.equal(access.allowed, true);
});

test('overlapping capability reads are bounded and a stale response cannot undo a mutation denial', async () => {
  let resolveRead, reads = 0;
  const access = createMutationAccess(async url => {
    if (url !== '/api/capabilities') return { status: 403 };
    reads++;
    if (reads === 1) return { ok: true, json: async () => ({ mutationsAllowed: true, editorAllowed: true }) };
    return new Promise(resolve => { resolveRead = resolve; });
  });
  await access.refresh();
  const first = access.refresh(), second = access.refresh();
  assert.equal(reads, 2);
  await access.request('/api/scenarios/reset', { method: 'POST' });
  assert.equal(access.allowed, false);
  resolveRead({ ok: true, json: async () => ({ mutationsAllowed: true, editorAllowed: true }) });
  await Promise.all([first, second]);
  assert.equal(access.allowed, false);
});

test('unchanged capability polls do not repeat status announcements, including editor-only changes', async () => {
  let result = { mutationsAllowed: true, editorAllowed: true };
  const access = createMutationAccess(async () => ({ ok: true, json: async () => result }));
  const announcements = [];
  access.subscribe(() => announcements.push([access.message, access.editorMessage]));
  await access.refresh();
  await access.refresh();
  await access.refresh();
  assert.equal(announcements.length, 2);
  result.editorAllowed = false;
  await access.refresh();
  assert.equal(announcements.length, 3);
  assert.equal(announcements[1][0], announcements[2][0]);
  assert.notEqual(announcements[1][1], announcements[2][1]);
  await access.refresh();
  assert.equal(announcements.length, 3);
  result.mutationsAllowed = false;
  await access.refresh();
  assert.equal(announcements.length, 4);
  result.editorAllowed = true;
  await access.refresh();
  assert.equal(announcements.length, 4);
  access.invalidate();
  access.invalidate();
  assert.equal(announcements.length, 5);
});

test('capability changes and dynamic fault controls stay disabled through busy completion', async () => {
  let enabled = false;
  const access = createMutationAccess(async () => ({
    ok: true, json: async () => ({ mutationsAllowed: enabled, editorAllowed: enabled })
  }));
  const navigation = { disabled: false };
  const controls = [{ disabled: false }];
  const root = { querySelectorAll: () => controls };
  access.subscribe(() => syncMutationControls(root, access));
  assert.equal(controls[0].disabled, true);
  enabled = true;
  await access.refresh();
  assert.equal(controls[0].disabled, false);
  syncMutationControls(root, access, true);
  assert.equal(controls[0].disabled, true);
  controls.push({ disabled: false });
  enabled = false;
  await access.refresh();
  syncMutationControls(root, access, false);
  assert.ok(controls.every(control => control.disabled));
  assert.equal(navigation.disabled, false);
  await access.request('/api/building-view');
});

test('request errors show problem details, not raw JSON, and tolerate empty or unreadable bodies', async () => {
  const response = text => ({ text: async () => text });
  assert.equal(await responseDetail(response('{"title":"Forbidden","detail":"Changes are disabled."}')), 'Changes are disabled.');
  assert.equal(await responseDetail(response('"Sensor has an active fault."')), 'Sensor has an active fault.');
  assert.equal(await responseDetail(response('{"traceId":"internal"}')), t('requestNoDetail'));
  assert.equal(await responseDetail(response('Plain error')), 'Plain error');
  assert.equal(await responseDetail(response('')), t('requestNoDetail'));
  assert.equal(await responseDetail({ text: async () => { throw new Error(); } }), t('requestNoDetail'));
});

test('mutation HTML starts disabled and access status fallbacks match localized messages', async () => {
  const markup = await readFile(new URL('../src/Devices.BuildingControl.Web/wwwroot/index.html', import.meta.url), 'utf8');
  for (const [, tag] of markup.matchAll(/<((?:button|select|input)\b[^>]*\bdata-mutation[^>]*)>/g))
    assert.match(tag, /\bdisabled\b/);
  for (const [, fallback] of markup.matchAll(/<p[^>]*data-i18n="mutationAccess_checking"[^>]*>([^<]+)<\/p>/g))
    assert.equal(fallback, t('mutationAccess_checking'));
});
