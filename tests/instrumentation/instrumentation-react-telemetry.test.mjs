// @vitest-environment node
import assert from 'node:assert/strict';
const { test } = process.env.VITEST ? await import('vitest') : await import('node:test');
import { getTotals, startTelemetryPolling } from '../../src/Devices.Instrumentation.Web/frontend/telemetry.ts';

const controller = (overrides = {}) => ({
  id: 'one',
  floor: 1,
  status: 'Healthy',
  lastSeen: '2026-01-01T00:00:00Z',
  rooms: [],
  faults: [],
  revision: 1,
  ...overrides
});

const transport = { mqttConnected: true, httpAvailable: true, lastMqttConnectedAt: null, message: 'connected' };
const event = {
  eventId: 'event-one',
  controllerId: 'one',
  eventType: 'state.changed',
  timestamp: '2026-01-01T00:00:00Z',
  state: controller()
};

test('totals distinguish online faulted controllers and faulted fixtures', () => {
  const totals = getTotals([
    controller({ status: 'Faulted', faults: [{ id: 'sensor', scope: 'room', targetId: 'room', description: 'failed' }], rooms: [{ id: 'room', name: 'Room', controllerId: 'one', sensorTriggered: true, presence: true, lightStrips: [
      { id: 'on', roomId: 'room', isOn: true, isFaulted: false },
      { id: 'fault', roomId: 'room', isOn: true, isFaulted: true },
      { id: 'off', roomId: 'room', isOn: false, isFaulted: false }
    ] }] }),
    controller({ id: 'two', status: 'Offline' })
  ]);
  assert.deepEqual(totals, { controllers: 2, online: 1, faulted: 1, faults: 1, rooms: 1, presence: 1, strips: 3, lightsOn: 1, stripsFaulted: 1 });
});

test('only known healthy and faulted statuses count as online, regardless of case', () => {
  const totals = getTotals(['Healthy', 'healthy', 'FAULTED', 'Offline', 'unknown', '', 'Online']
    .map(status => controller({ status })));
  assert.equal(totals.controllers, 7);
  assert.equal(totals.online, 3);
  assert.equal(totals.faulted, 1);
});

test('polling prevents overlaps, reports failures, recovers and stops cleanly', async () => {
  let release;
  let tick;
  let cancelled = false;
  let fail = false;
  const requests = [];
  const snapshots = [];
  const errors = [];
  const gate = new Promise(resolve => { release = resolve; });
  const payloads = { '/api/telemetry': [controller()], '/api/events': [event], '/api/status': transport };
  const stop = startTelemetryPolling({
    fetcher: async (url, options) => {
      requests.push({ url, signal: options.signal });
      await gate;
      return { ok: !fail, json: async () => payloads[url] };
    },
    onSnapshot: value => snapshots.push(value),
    onError: error => errors.push(error),
    schedule: callback => { tick = callback; return 42; },
    cancel: timer => { assert.equal(timer, 42); cancelled = true; }
  });
  await tick();
  assert.equal(requests.length, 3);
  release();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(snapshots, [{ controllers: payloads['/api/telemetry'], events: payloads['/api/events'], transport }]);
  fail = true;
  await tick();
  assert.equal(errors.length, 1);
  fail = false;
  await tick();
  assert.equal(snapshots.length, 2);
  stop();
  assert.equal(cancelled, true);
  assert.equal(requests[0].signal.aborted, true);
  await tick();
  assert.equal(requests.length, 9);
});

test('stopping an in-flight poll ignores its result', async () => {
  let release;
  let calls = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const stop = startTelemetryPolling({
    fetcher: async url => {
      await gate;
      const payloads = { '/api/telemetry': [], '/api/events': [], '/api/status': transport };
      return { ok: true, json: async () => payloads[url] };
    },
    onSnapshot: () => calls++,
    onError: () => calls++,
    schedule: () => 1,
    cancel: () => {}
  });
  stop();
  release();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 0);
});

test('malformed response is reported as an error instead of a snapshot', async () => {
  let errors = 0;
  let snapshots = 0;
  const stop = startTelemetryPolling({
    fetcher: async url => {
      const payloads = { '/api/telemetry': {}, '/api/events': [], '/api/status': transport };
      return { ok: true, json: async () => payloads[url] };
    },
    onSnapshot: () => snapshots++,
    onError: () => errors++,
    schedule: () => 1,
    cancel: () => {}
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(errors, 1);
  assert.equal(snapshots, 0);
  stop();
});

test('invalid DTO fields are rejected instead of becoming a typed snapshot', async () => {
  let errors = 0;
  const stop = startTelemetryPolling({
    fetcher: async url => {
      const payloads = {
        '/api/telemetry': [controller({ rooms: [{ id: 'room', name: 'Room', controllerId: 'one', presence: true, lightStrips: [] }] })],
        '/api/events': [],
        '/api/status': transport
      };
      return { ok: true, json: async () => payloads[url] };
    },
    onSnapshot: () => assert.fail('Invalid DTO must not produce a snapshot'),
    onError: () => errors++,
    schedule: () => 1,
    cancel: () => {}
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(errors, 1);
  stop();
});

test('validates optional HTTP source while accepting missing, null, and string values', async () => {
  for (const [source, valid] of [[undefined, true], [null, true], ['http://simulator:5080', true], [42, false], [{}, false]]) {
    let snapshots = 0;
    let errors = 0;
    const status = { ...transport };
    if (source !== undefined) status.simulatorHttpSource = source;
    const stop = startTelemetryPolling({
      fetcher: async url => ({ ok: true, json: async () => url === '/api/status' ? status : [] }),
      onSnapshot: () => snapshots++,
      onError: () => errors++,
      schedule: () => 1,
      cancel: () => {}
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(snapshots, valid ? 1 : 0);
    assert.equal(errors, valid ? 0 : 1);
    stop();
  }
});

for (const stalledStage of ['fetch', 'body']) {
  test(`a stalled ${stalledStage} times out, aborts, retries, and ignores late results`, async () => {
    let tick;
    let deadline;
    let release;
    let stalled = true;
    let timerClears = 0;
    const signals = [];
    const errors = [];
    const snapshots = [];
    const gate = new Promise(resolve => { release = resolve; });
    const payloads = { '/api/telemetry': [controller()], '/api/events': [], '/api/status': transport };
    const stop = startTelemetryPolling({
      fetcher: async (url, { signal }) => {
        signals.push(signal);
        const wait = stalled;
        if (wait && stalledStage === 'fetch') await gate;
        return { ok: true, json: async () => {
          if (wait && stalledStage === 'body') await gate;
          return payloads[url];
        } };
      },
      onSnapshot: value => snapshots.push(value),
      onError: error => errors.push(error),
      schedule: callback => { tick = callback; return 1; },
      cancel: () => {},
      setTimeout: (callback, delay) => { deadline = callback; assert.equal(delay, 5000); return 2; },
      clearTimeout: () => timerClears++
    });
    await new Promise(resolve => setImmediate(resolve));
    await tick();
    assert.equal(signals.length, 3, 'the pending batch must not overlap');
    deadline();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(signals[0].aborted, true);
    assert.match(errors[0].message, /timed out/);
    assert.equal(timerClears, 1);
    stalled = false;
    await tick();
    assert.equal(snapshots.length, 1);
    assert.equal(signals[3].aborted, true, 'completed batches clean up their signals');
    release();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(snapshots.length, 1, 'late results cannot replace the recovered snapshot');
    assert.equal(timerClears, 2);
    stop();
  });
}

test('stopping a stalled request clears its deadline and does not announce errors', async () => {
  let cleared = 0;
  let signal;
  let calls = 0;
  const stop = startTelemetryPolling({
    fetcher: async (_, options) => { signal = options.signal; return new Promise(() => {}); },
    onSnapshot: () => calls++,
    onError: () => calls++,
    schedule: () => 1,
    cancel: () => {},
    setTimeout: () => 2,
    clearTimeout: timer => { assert.equal(timer, 2); cleared++; }
  });
  stop();
  assert.equal(signal.aborted, true);
  assert.equal(cleared, 1);
  assert.equal(calls, 0);
});
