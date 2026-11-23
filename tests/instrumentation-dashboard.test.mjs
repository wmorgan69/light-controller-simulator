import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('dashboard renders escaped telemetry and localized refresh failure states', async () => {
  const elements = new Map();
  for (const id of ['summaryCards', 'activityCaption', 'lightingSummary', 'controllerCount',
    'controllers', 'eventCount', 'events', 'connectionStatus', 'connectionStatusText']) {
    const classes = new Set();
    elements.set(`#${id}`, {
      textContent: '',
      innerHTML: '',
      classList: {
        toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); },
        remove(name) { classes.delete(name); },
        add(name) { classes.add(name); },
        contains(name) { return classes.has(name); }
      }
    });
  }

  const telemetry = [{
    id: 'controller<&',
    floor: '<1>',
    status: '<unknown>',
    rooms: [{
      name: '<Room>',
      presence: true,
      lightStrips: [{ id: 'light"<&', isOn: true, isFaulted: false }]
    }],
    faults: [{ description: '<fault>' }]
  }];
  const events = [
    { eventType: 'state.changed', timestamp: 'invalid', controllerId: 'controller<&' },
    { eventType: '<custom.event>', timestamp: '"><script>', controllerId: '<controller>' }
  ];
  let release;
  const started = new Promise(resolve => { release = resolve; });
  let failing = false;
  let refresh;
  const originals = { document: globalThis.document, fetch: globalThis.fetch, setInterval: globalThis.setInterval };

  try {
    globalThis.document = {
      querySelector: selector => {
        assert.ok(elements.has(selector), `Unexpected selector: ${selector}`);
        return elements.get(selector);
      },
      querySelectorAll: () => []
    };
    globalThis.fetch = async url => {
      await started;
      if (failing) throw new Error('network error');
      const payloads = { '/api/telemetry': telemetry, '/api/events': events, '/api/status': { mqttConnected: true } };
      assert.ok(Object.hasOwn(payloads, url), `Unexpected request: ${url}`);
      return { ok: true, json: async () => payloads[url] };
    };
    globalThis.setInterval = callback => { refresh = callback; };

    const appUrl = new URL('../src/Devices.Instrumentation.Web/wwwroot/app.js', import.meta.url);
    const resourceUrl = new URL('../src/Devices.Instrumentation.Web/wwwroot/localization.en.mjs', import.meta.url);
    const source = readFileSync(appUrl, 'utf8').replace("'./localization.en.mjs'", JSON.stringify(resourceUrl.href));
    await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
    release();
    await new Promise(resolve => setImmediate(resolve));

    const controllers = elements.get('#controllers').innerHTML;
    assert.match(controllers, /title="light&quot;&lt;&amp;: on"/);
    assert.match(controllers, /aria-label="1 of 1 lights on"/);
    assert.match(controllers, /&lt;Room&gt;/);
    assert.match(controllers, /&lt;unknown&gt;/);
    assert.match(controllers, /&lt;fault&gt;/);
    assert.doesNotMatch(controllers, /<Room>|<fault>|<unknown>/);
    const renderedEvents = elements.get('#events').innerHTML;
    assert.match(renderedEvents, /<strong>state changed<\/strong>/);
    assert.match(renderedEvents, /<strong>&lt;custom event&gt;<\/strong>/);
    assert.match(renderedEvents, /datetime="&quot;&gt;&lt;script&gt;"/);
    assert.match(renderedEvents, /controller&lt;&amp;/);
    assert.doesNotMatch(renderedEvents, /<script>|<custom event>/);
    assert.equal(elements.get('#connectionStatusText').textContent, '1 controller reporting · MQTT');

    failing = true;
    await refresh();
    assert.equal(elements.get('#connectionStatusText').textContent, 'Instrumentation API unavailable');
    assert.equal(elements.get('#summaryCards').innerHTML, '<p class="empty-state">Live summary unavailable.</p>');
    assert.equal(elements.get('#lightingSummary').innerHTML, '<p class="empty-state">Lighting activity unavailable.</p>');
    assert.equal(elements.get('#controllers').innerHTML, '<p class="empty-state">Could not load controller state. Check the instrumentation service.</p>');
    assert.equal(elements.get('#events').innerHTML, '<p class="empty-state">Recent events unavailable.</p>');
    assert.equal(elements.get('#connectionStatus').classList.contains('is-error'), true);
    assert.equal(elements.get('#connectionStatus').classList.contains('is-connected'), false);

    failing = false;
    await refresh();
    assert.equal(elements.get('#connectionStatusText').textContent, '1 controller reporting · MQTT');
    assert.equal(elements.get('#connectionStatus').classList.contains('is-error'), false);
    assert.equal(elements.get('#connectionStatus').classList.contains('is-connected'), true);
  } finally {
    Object.assign(globalThis, originals);
  }
});
