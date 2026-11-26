import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { controllerStatusLabel, eventTypeLabel, localize } from '../../src/Devices.Instrumentation.Web/frontend/localization.en.ts';

test('all static markup localization keys exist', () => {
  const markup = readFileSync(new URL('../../src/Devices.Instrumentation.Web/wwwroot/index.html', import.meta.url), 'utf8');
  const keys = [...markup.matchAll(/data-i18n(?:-aria-label)?="([^"]+)"/g)].map(([, key]) => key);
  assert.ok(keys.length > 0);
  for (const key of keys) assert.doesNotThrow(() => localize(key));
});

test('static text and accessibility labels remain available before localization starts', () => {
  const markup = readFileSync(new URL('../../src/Devices.Instrumentation.Web/wwwroot/index.html', import.meta.url), 'utf8');
  const textElements = [...markup.matchAll(/<[^>]+\bdata-i18n="([^"]+)"[^>]*>([^<]*)<\/[^>]+>/g)];
  const labelElements = [...markup.matchAll(/<[^>]+\baria-label="([^"]+)"[^>]*\bdata-i18n-aria-label="([^"]+)"[^>]*>/g)];
  assert.equal(textElements.length, [...markup.matchAll(/\bdata-i18n="/g)].length);
  assert.equal(labelElements.length, [...markup.matchAll(/\bdata-i18n-aria-label="/g)].length);
  assert.ok(textElements.length > 0);
  assert.ok(labelElements.length > 0);
  for (const [, key, text] of textElements) assert.equal(text, localize(key));
  for (const [, label, key] of labelElements) assert.equal(label, localize(key));
  assert.match(markup, /<span class="status-dot" aria-hidden="true"><\/span>/);
});

test('loads the React application and its styles', () => {
  const markup = readFileSync(new URL('../../src/Devices.Instrumentation.Web/wwwroot/index.html', import.meta.url), 'utf8');
  assert.match(markup, /<script\s+type="module"\s+src="\/dist\/app\.js"><\/script>/);
  assert.match(markup, /<link\s+rel="stylesheet"\s+href="\/dist\/app\.css">/);
});

test('looks up English resources and interpolates values', () => {
  assert.equal(localize('documentTitle'), 'Lighting Instrumentation');
  assert.equal(localize('totalControllers', { count: 4 }), 'of 4 total');
  assert.equal(localize('eventsShown', { shown: 12, total: 29 }), 'Showing 12 of 29 available');
  assert.equal(localize('controllerId', { id: '<controller>' }), 'Controller ID: <controller>');
  assert.equal(localize('httpPollingDetails', { state: 'available', source: 'Source: http://simulator:5080' }), 'HTTP polling: available · Source: http://simulator:5080');
});

test('formats singular and plural English messages', () => {
  assert.equal(localize('affectedControllers', { count: 1 }), '1 controller affected');
  assert.equal(localize('affectedControllers', { count: 2 }), '2 controllers affected');
  assert.equal(localize('faultedFixtureCount', { count: 1 }), '1 faulted fixture');
  assert.equal(localize('faultedFixtureCount', { count: 2 }), '2 faulted fixtures');
  assert.equal(localize('fixtureRowAriaLabel', { on: 1, total: 3, faulted: 2 }), '1 of 3 lights on, 2 faulted');
  assert.equal(localize('faultedFixtureIdentities', { ids: '<strip>' }), 'Faulted fixtures: <strip>');
});

test('maps known controller statuses and preserves unknown protocol values', () => {
  assert.equal(controllerStatusLabel('Healthy'), 'Healthy');
  assert.equal(controllerStatusLabel('FAULTED'), 'Faulted');
  assert.equal(controllerStatusLabel('Offline'), 'Offline');
  assert.equal(controllerStatusLabel('<custom-status>'), '<custom-status>');
  assert.equal(controllerStatusLabel('constructor'), 'constructor');
});

test('localizes known event types and retains the existing unknown event display', () => {
  assert.equal(eventTypeLabel('state.changed'), 'state changed');
  assert.equal(eventTypeLabel('fault.changed'), 'fault changed');
  assert.equal(eventTypeLabel('<custom.event>'), '<custom event>');
  assert.equal(eventTypeLabel('constructor'), 'constructor');
});

test('rejects unknown keys and missing interpolation values', () => {
  assert.throws(() => localize('notAResource'), /Unknown English resource key/);
  assert.throws(() => localize('totalControllers'), /Missing "count"/);
  assert.throws(() => localize('floorCount'), /requires a finite count/);
  assert.throws(() => localize('floorCount', { count: '1' }), /requires a finite count/);
  assert.throws(() => localize('floorCount', { count: Infinity }), /requires a finite count/);
});
