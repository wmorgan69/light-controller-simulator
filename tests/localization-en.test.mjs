import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { controllerStatusLabel, localizeMarkup, plural, t } from '../src/Devices.Simulator.Web/wwwroot/localization.en.mjs';

test('looks up English labels and interpolates dynamic values without changing their text', () => {
  assert.equal(t('pageTitle'), 'Building Light Simulator');
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
  const markup = await readFile(new URL('../src/Devices.Simulator.Web/wwwroot/index.html', import.meta.url), 'utf8');
  const keys = [...markup.matchAll(/\bdata-i18n(?:-aria-label|-title)?="([^"]+)"/g)].map(([, key]) => key);
  assert.ok(keys.length > 0);
  for (const key of keys) assert.equal(typeof t(key), 'string', `missing markup resource: ${key}`);
});

test('backs every statically referenced browser message with a resource entry', async () => {
  const app = await readFile(new URL('../src/Devices.Simulator.Web/wwwroot/app.js', import.meta.url), 'utf8');
  const keys = [...app.matchAll(/\bt\('([^']+)'/g)].map(([, key]) => key);
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
  assert.equal(textElement.textContent, 'Building Light Simulator');
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
