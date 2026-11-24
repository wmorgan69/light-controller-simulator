import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import Dashboard from '../src/Devices.Instrumentation.Web/frontend/Dashboard';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('marks cached telemetry as last observed when both transports fail and recovers live status', async () => {
  let tick;
  const nativeInterval = window.setInterval.bind(window);
  vi.spyOn(window, 'setInterval').mockImplementation((callback, delay, ...args) => {
    if (delay === 1000) { tick = callback; return 42; }
    return nativeInterval(callback, delay, ...args);
  });
  const transport = { mqttConnected: false, httpAvailable: false, lastMqttConnectedAt: null, message: '' };
  const controller = {
    id: 'controller-cached', floor: 1, status: 'Healthy', lastSeen: '2026-01-01T00:00:00Z',
    revision: 1, faults: [], rooms: []
  };
  vi.stubGlobal('fetch', vi.fn(async url => ({
    ok: true, json: async () => url === '/api/status' ? transport : url === '/api/telemetry' ? [controller] : []
  })));
  render(<Dashboard />);
  await screen.findByText('Last observed: Healthy');
  expect(screen.getByRole('status').textContent).toBe('Live telemetry unavailable');
  expect(screen.getByRole('status').classList.contains('is-connected')).toBe(false);
  expect(screen.getByText('Last observed online')).toBeTruthy();
  expect(screen.getByText('HTTP polling: unavailable · Source not reported')).toBeTruthy();
  expect(screen.getByText(/All values below are last observed, not current/)).toBeTruthy();
  transport.httpAvailable = true;
  await act(async () => { await tick(); });
  expect(screen.getByText('Healthy')).toBeTruthy();
  expect(screen.getByRole('status').classList.contains('is-connected')).toBe(true);
  expect(screen.queryByText('Last observed online')).toBeNull();
});

it('discloses HTTP polling separately from MQTT, including absent sources and API failures', async () => {
  let tick;
  const nativeInterval = window.setInterval.bind(window);
  vi.spyOn(window, 'setInterval').mockImplementation((callback, delay, ...args) => {
    if (delay === 1000) { tick = callback; return 42; }
    return nativeInterval(callback, delay, ...args);
  });
  const transport = { mqttConnected: true, httpAvailable: true, lastMqttConnectedAt: null, message: '',
    simulatorHttpSource: 'http://simulator:5080' };
  const controller = { id: 'one', floor: 1, status: 'Healthy', lastSeen: '', revision: 1, faults: [], rooms: [] };
  let failing = false;
  vi.stubGlobal('fetch', vi.fn(async url => ({
    ok: !failing, json: async () => url === '/api/status' ? transport : url === '/api/telemetry' ? [controller] : []
  })));
  render(<Dashboard />);
  await screen.findByText('HTTP polling: available · Source: http://simulator:5080');
  expect(screen.getByRole('status').textContent).toContain('MQTT + HTTP polling');
  transport.httpAvailable = false;
  transport.simulatorHttpSource = null;
  await act(async () => { await tick(); });
  expect(screen.getByText('HTTP polling: unavailable · Source not reported')).toBeTruthy();
  expect(screen.getByRole('status').textContent).toContain('MQTT');
  delete transport.simulatorHttpSource;
  transport.httpAvailable = true;
  await act(async () => { await tick(); });
  expect(screen.getByText('HTTP polling: available · Source not reported')).toBeTruthy();
  failing = true;
  await act(async () => { await tick(); });
  expect(screen.getByText('HTTP polling state and source unavailable.')).toBeTruthy();
  expect(screen.queryByText(/http:\/\/simulator:5080/)).toBeNull();
});

it('exposes fixture fault counts and identities, even without controller fault records, and escapes IDs', async () => {
  const controller = {
    id: 'controller-fixtures', floor: 1, status: 'Faulted', lastSeen: '2026-01-01T00:00:00Z',
    revision: 1, faults: [], rooms: [{
      id: 'room', name: 'Office', controllerId: 'controller-fixtures', sensorTriggered: false, presence: false,
      lightStrips: [
        { id: '<fault-1>', roomId: 'room', isOn: true, isFaulted: true },
        { id: 'fault-2', roomId: 'room', isOn: false, isFaulted: true },
        { id: 'on', roomId: 'room', isOn: true, isFaulted: false }
      ]
    }]
  };
  vi.stubGlobal('fetch', vi.fn(async url => ({
    ok: true, json: async () => url === '/api/status'
      ? { mqttConnected: true, httpAvailable: false, lastMqttConnectedAt: null, message: '' }
      : url === '/api/telemetry' ? [controller] : []
  })));
  const { container } = render(<Dashboard />);
  await screen.findByText('Faulted fixtures: <fault-1>, fault-2');
  expect(screen.getByRole('img', { name: '1 of 3 lights on, 2 faulted; Faulted fixtures: <fault-1>, fault-2' })).toBeTruthy();
  expect(screen.getByText(/2 faulted fixtures/)).toBeTruthy();
  expect(container.querySelector('fault-1')).toBeNull();
});

it('renders external telemetry and event values as text rather than markup', async () => {
  const controller = {
    id: 'controller<&', floor: 1, status: '<unknown>', lastSeen: '', revision: 1,
    faults: [{ id: 'fault', scope: 'sensor', targetId: 'sensor', description: '<fault>' }],
    rooms: [{
      id: 'room', name: '<Room>', controllerId: 'controller<&', sensorTriggered: false, presence: true,
      lightStrips: [{ id: 'light"<&', roomId: 'room', isOn: true, isFaulted: false }]
    }]
  };
  const events = [{ eventId: 'event', controllerId: '<controller>', eventType: '<custom.event>',
    timestamp: '"><script>', state: controller }];
  vi.stubGlobal('fetch', vi.fn(async url => ({
    ok: true, json: async () => url === '/api/status'
      ? { mqttConnected: true, httpAvailable: true, lastMqttConnectedAt: null, message: '' }
      : url === '/api/telemetry' ? [controller] : events
  })));
  const { container } = render(<Dashboard />);
  await screen.findByText('<Room>');
  expect(screen.getByRole('heading', { name: 'Floor 1' })).toBeTruthy();
  expect(screen.getByText('Controller ID: controller<&')).toBeTruthy();
  expect(screen.getByText('<unknown>')).toBeTruthy();
  expect(screen.getByText('<fault>')).toBeTruthy();
  expect(screen.getByText('<custom event>')).toBeTruthy();
  expect(screen.getByText('<controller>')).toBeTruthy();
  expect(screen.getByTitle('light"<&: on')).toBeTruthy();
  expect(container.querySelector('script, room, fault, controller, unknown')).toBeNull();
});

it('shows only the first 12 available events until expanded and follows refreshed snapshots', async () => {
  let tick;
  const nativeInterval = window.setInterval.bind(window);
  vi.spyOn(window, 'setInterval').mockImplementation((callback, delay, ...args) => {
    if (delay === 1000) { tick = callback; return 42; }
    return nativeInterval(callback, delay, ...args);
  });
  const controller = { id: 'controller-with-a-very-long-identifier-123456789', floor: 12, status: 'Healthy',
    lastSeen: '', revision: 1, faults: [], rooms: [] };
  let events = Array.from({ length: 29 }, (_, index) => ({
    eventId: `event-${index}`, controllerId: `event-controller-${index}`,
    eventType: 'state.changed', timestamp: '2026-01-01T00:00:00Z', state: controller
  }));
  vi.stubGlobal('fetch', vi.fn(async url => ({
    ok: true, json: async () => url === '/api/status'
      ? { mqttConnected: true, httpAvailable: true, lastMqttConnectedAt: null, message: '' }
      : url === '/api/telemetry' ? [controller] : events
  })));
  render(<Dashboard />);
  const panel = await screen.findByRole('complementary', { name: 'Recent events' });
  expect(screen.getByRole('heading', { name: 'Floor 12' })).toBeTruthy();
  expect(screen.getByText(`Controller ID: ${controller.id}`)).toBeTruthy();
  expect(within(panel).getByText('Showing 12 of 29 available')).toBeTruthy();
  expect(within(panel).getByRole('region', { name: 'Available recent events' }).tabIndex).toBe(0);
  expect(within(panel).getAllByRole('article')).toHaveLength(12);
  expect(within(panel).queryByText('event-controller-28')).toBeNull();
  const toggle = within(panel).getByRole('button', { name: 'Show all available events' });
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(toggle);
  expect(within(panel).getByText('Showing 29 of 29 available')).toBeTruthy();
  expect(within(panel).getByText('event-controller-28')).toBeTruthy();
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  events = events.slice(0, 15);
  await act(async () => { await tick(); });
  expect(within(panel).getByText('Showing 15 of 15 available')).toBeTruthy();
  fireEvent.click(within(panel).getByRole('button', { name: 'Show fewer events' }));
  expect(within(panel).getByText('Showing 12 of 15 available')).toBeTruthy();
  events = events.slice(0, 1);
  await act(async () => { await tick(); });
  expect(within(panel).getByText('Showing 1 of 1 available')).toBeTruthy();
  expect(within(panel).queryByRole('button')).toBeNull();
  events = [];
  await act(async () => { await tick(); });
  expect(within(panel).getByText('Showing 0 of 0 available')).toBeTruthy();
  expect(within(panel).getByText('No events recorded yet.')).toBeTruthy();
});

it('clears previously live values after a stalled refresh and recovers on a later poll', async () => {
  vi.useFakeTimers();
  let stalled = false;
  vi.stubGlobal('fetch', vi.fn(async url => {
    if (stalled) return new Promise(() => {});
    return { ok: true, json: async () => url === '/api/status'
      ? { mqttConnected: true, httpAvailable: true, lastMqttConnectedAt: null, message: '' }
      : url === '/api/telemetry'
        ? [{ id: 'live-controller', floor: 1, status: 'Healthy', lastSeen: '', revision: 1, rooms: [], faults: [] }]
        : [] };
  }));
  render(<Dashboard />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(screen.getByText('Controller ID: live-controller')).toBeTruthy();
  stalled = true;
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(screen.getByRole('status').textContent).toBe('Instrumentation API unavailable');
  expect(screen.queryByText('Controller ID: live-controller')).toBeNull();
  stalled = false;
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(screen.getByText('Controller ID: live-controller')).toBeTruthy();
});

it('shows waiting, an API failure, then a recovered snapshot and stops polling on unmount', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  let failing = true;
  let tick;
  const nativeInterval = window.setInterval.bind(window);
  const interval = vi.spyOn(window, 'setInterval').mockImplementation((callback, delay, ...args) => {
    if (delay === 1000) { tick = callback; return 42; }
    return nativeInterval(callback, delay, ...args);
  });
  const clear = vi.spyOn(window, 'clearInterval');
  const transport = { mqttConnected: false, httpAvailable: true, lastMqttConnectedAt: null, message: '' };
  const controller = {
    id: 'controller-1', floor: 1, status: 'Healthy', lastSeen: '2026-01-01T00:00:00Z', revision: 1,
    faults: [], rooms: [{ id: 'room-1', name: 'Office', controllerId: 'controller-1', sensorTriggered: true,
      presence: true, lightStrips: [{ id: 'light-1', roomId: 'room-1', isOn: true, isFaulted: false }] }]
  };
  const fetcher = vi.fn(async (url, options) => {
    await pending;
    return { ok: !failing, json: async () => url === '/api/telemetry' ? [controller] : url === '/api/events' ? [] : transport };
  });
  vi.stubGlobal('fetch', fetcher);
  const { unmount } = render(<Dashboard />);
  expect(screen.getByRole('status').textContent).toContain('Waiting for telemetry');
  await act(async () => { release(); });
  await screen.findByText('Instrumentation API unavailable');
  expect(screen.getByText('Live data unavailable. Retrying automatically.')).toBeTruthy();
  expect(screen.getByText('Could not load controller state. Check the instrumentation service.')).toBeTruthy();
  failing = false;
  await act(async () => { tick(); });
  await screen.findByText('Office');
  expect(screen.getByRole('status').textContent).toContain('1 controller reporting · HTTP fallback');
  expect(screen.getByRole('img', { name: '1 lights on, 0 off, 0 faulted' })).toBeTruthy();
  const signal = fetcher.mock.calls[0][1].signal;
  unmount();
  expect(clear).toHaveBeenCalledWith(42);
  expect(signal.aborted).toBe(true);
  const calls = fetcher.mock.calls.length;
  tick();
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(calls));
  expect(interval).toHaveBeenCalledWith(expect.any(Function), 1000);
});
