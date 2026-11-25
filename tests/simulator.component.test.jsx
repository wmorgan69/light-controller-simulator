import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

// jsdom cannot create the WebGL renderer; the rest of the app runs normally.
vi.mock('../src/Devices.BuildingControl.Web/frontend/scene/SceneCanvas', () => ({ SceneCanvas: () => null }));
import { App } from '../src/Devices.BuildingControl.Web/frontend/SimulatorApp';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('shows a concise building status with expandable diagnostics', async () => {
  const json = body => ({ ok: true, status: 200, json: async () => body });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('fetch', vi.fn(async url => {
    if (url === '/api/building-view') return json({ design: null, controllers: [] });
    if (url === '/api/capabilities') return json({ mutationsAllowed: true, editorAllowed: false });
    if (url === '/api/status') return json({ mqttConnected: true });
    if (url === '/api/building-design-status') return json({
      savedRevision: 2, runningRevision: 2, activationStatus: 'active',
      pendingCleanup: 0, failedCleanup: 1, completedCleanup: 0
    });
    return { ok: false, status: 503 };
  }));
  render(<App />);
  expect(await screen.findByText('Building active · controller cleanup needs attention')).toBeTruthy();
  const details = screen.getByText(/Building status details/).closest('details');
  expect(details.open).toBe(false);
  expect(within(details).getByText(/saved revision 2/)).toBeTruthy();
  fireEvent.click(screen.getByText(/Building status details/));
  expect(details.open).toBe(true);
});

it('distinguishes initial loading from an unavailable building state', async () => {
  let rejectBuilding;
  const building = new Promise((_, reject) => { rejectBuilding = reject; });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('fetch', vi.fn(url => {
    if (url === '/api/building-view') return building;
    if (url === '/api/capabilities') return Promise.resolve({ ok: true, json: async () => ({ mutationsAllowed: true, editorAllowed: false }) });
    if (url === '/api/status') return Promise.resolve({ ok: true, json: async () => ({ mqttConnected: false }) });
    return Promise.resolve({ ok: false, status: 503 });
  }));
  render(<App />);
  expect(screen.getByRole('button', { name: 'Open building menu' })).toBeTruthy();
  expect(screen.getByRole('navigation', { name: 'Building floors' })).toBeTruthy();
  expect(screen.getByRole('group', { name: 'Scenarios' })).toBeTruthy();
  expect(screen.getAllByText('Loading floors...').length).toBeGreaterThan(0);
  await act(async () => { rejectBuilding(new Error('Network unavailable')); });
  expect(await screen.findByText('Unable to load building state: Network unavailable')).toBeTruthy();
  expect(screen.queryByText('Loading floors...')).toBeNull();
  expect(screen.getAllByText(/floor.*unavailable/i).length).toBeGreaterThan(0);
});

it('opens navigation, selects a floor, and restores focus when dismissed', async () => {
  const controller = {
    id: 'controller-1', floor: 1, status: 'Healthy', lastSeen: '2026-01-01T00:00:00Z',
    revision: 1, rooms: [], faults: []
  };
  const json = body => ({ ok: true, status: 200, json: async () => body });
  let desktopChange;
  const desktop = { matches: false, addEventListener(_type, listener) { desktopChange = listener; }, removeEventListener() {} };
  vi.stubGlobal('matchMedia', query => query.includes('min-width')
    ? desktop : { matches: false, addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal('fetch', vi.fn(async url => {
    if (url === '/api/building-view') return json({ design: null, controllers: [controller] });
    if (url === '/api/capabilities') return json({ mutationsAllowed: true, editorAllowed: false });
    if (url === '/api/status') return json({ mqttConnected: true });
    return { ok: false, status: 503 };
  }));
  render(<App />);
  await screen.findByText('0/0 rooms occupied');
  const trigger = screen.getByRole('button', { name: 'Open building navigation' });
  trigger.focus();
  fireEvent.click(trigger);
  const drawer = await screen.findByRole('dialog', { name: 'Building floors' });
  fireEvent.click(within(drawer).getByRole('button', { name: 'All floors' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Building floors' })).toBeNull());
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(trigger);
  expect(screen.getByRole('button', { name: 'All floors' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(trigger);
  await screen.findByRole('dialog', { name: 'Building floors' });
  trigger.style.display = 'none';
  desktop.matches = true;
  act(() => desktopChange());
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Building floors' })).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'All floors' })));
});

it('opens and dismisses the portaled building menu and restores its trigger focus', async () => {
  const json = body => ({ ok: true, status: 200, json: async () => body });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('fetch', vi.fn(async url => {
    if (url === '/api/building-view') return json({ design: null, controllers: [] });
    if (url === '/api/capabilities') return json({ mutationsAllowed: true, editorAllowed: true });
    if (url === '/api/status') return json({ mqttConnected: true });
    return { ok: false, status: 503 };
  }));
  render(<App />);
  const trigger = screen.getByRole('button', { name: 'Open building menu' });
  const heading = screen.getByRole('heading', { name: 'Building Control' });
  expect(within(heading.parentElement).getByText('Connection: Simulated')).toBeTruthy();
  expect(heading.compareDocumentPosition(trigger) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(trigger.textContent).toContain('Building menu');
  expect(trigger.querySelector('[data-testid="MoreVertIcon"]')).toBeTruthy();
  trigger.focus();
  fireEvent.click(trigger);
  const item = await screen.findByRole('menuitem', { name: 'Edit building' });
  fireEvent.keyDown(item, { key: 'Escape' });
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
});

it('focuses desktop navigation after resizing when no floors are available', async () => {
  let desktopChange;
  const desktop = { matches: false, addEventListener(_type, listener) { desktopChange = listener; }, removeEventListener() {} };
  vi.stubGlobal('matchMedia', query => query.includes('min-width')
    ? desktop : { matches: false, addEventListener() {}, removeEventListener() {} });
  const json = body => ({ ok: true, status: 200, json: async () => body });
  vi.stubGlobal('fetch', vi.fn(async url => {
    if (url === '/api/building-view') return json({ design: null, controllers: [] });
    if (url === '/api/capabilities') return json({ mutationsAllowed: true, editorAllowed: false });
    if (url === '/api/status') return json({ mqttConnected: true });
    return { ok: false, status: 503 };
  }));
  render(<App />);
  const trigger = screen.getByRole('button', { name: 'Open building navigation' });
  fireEvent.click(trigger);
  await screen.findByRole('dialog', { name: 'Building floors' });
  trigger.style.display = 'none';
  desktop.matches = true;
  act(() => desktopChange());
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Building floors' })).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('navigation', { name: 'Building floors' }).parentElement));
});

it('retains the authoritative room state after a failed mutation and applies the successful retry', async () => {
  const room = {
    id: 'floor-1-office', name: 'Office', controllerId: 'controller-1', sensorId: 'sensor-1',
    sensorTriggered: false, presence: false, lightStrips: []
  };
  const controller = {
    id: 'controller-1', floor: 1, status: 'Healthy', lastSeen: '2026-01-01T00:00:00Z',
    revision: 1, rooms: [room], faults: []
  };
  const updated = { ...controller, revision: 2, rooms: [{ ...room, presence: true, sensorTriggered: true }] };
  let attempts = 0;
  const json = body => ({ ok: true, status: 200, json: async () => body });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  const fetcher = vi.fn(async url => {
    if (url === '/api/building-view') return json({ design: null, controllers: [controller] });
    if (url === '/api/capabilities') return json({ mutationsAllowed: true, editorAllowed: false });
    if (url === '/api/status') return json({ mqttConnected: true });
    if (url === '/api/rooms/floor-1-office/sensor/trigger') {
      attempts++;
      return attempts === 1
        ? { ok: false, status: 503, text: async () => 'Sensor unavailable' }
        : json(updated);
    }
    return { ok: false, status: 503 };
  });

  vi.stubGlobal('fetch', fetcher);
  render(<App />);
  const inspector = await screen.findByRole('region', { name: 'Room controls' });
  const presence = within(inspector).getByRole('checkbox', { name: 'Presence' });
  await act(async () => {});
  expect(presence.disabled).toBe(false);
  fireEvent.click(presence);
  expect(await within(inspector).findByText(/Sensor unavailable/)).toBeTruthy();
  expect(presence.checked).toBe(false);
  fireEvent.click(presence);
  await screen.findByText('1/1 rooms occupied');
  expect(presence.checked).toBe(true);
  expect(within(inspector).queryByText(/Sensor unavailable/)).toBeNull();
  expect(fetcher.mock.calls.filter(([url]) => url === '/api/building-view')).toHaveLength(1);
});

it('distinguishes sensor faults with duplicate room names and preserves unknown target IDs', async () => {
  const rooms = ['Office', 'Office'].map((name, index) => ({
    id: `floor-1-room-${index}`, name, controllerId: 'controller-1', sensorId: `sensor-${index}`,
    sensorTriggered: false, presence: false, lightStrips: []
  }));
  const controller = {
    id: 'controller-1', floor: 1, status: 'Faulted', lastSeen: '2026-01-01T00:00:00Z', revision: 1, rooms,
    faults: [
      { id: 'fault-1', scope: 'sensor', targetId: 'sensor-0', description: 'Simulated sensor fault' },
      { id: 'fault-2', scope: 'sensor', targetId: 'sensor-1', description: 'Simulated sensor fault' },
      { id: 'fault-3', scope: 'sensor', targetId: 'unknown-sensor', description: 'Unknown sensor' }
    ]
  };
  const json = body => ({ ok: true, status: 200, json: async () => body });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('fetch', vi.fn(async url => {
    if (url === '/api/building-view') return json({ design: null, controllers: [controller] });
    if (url === '/api/capabilities') return json({ mutationsAllowed: true, editorAllowed: false });
    if (url === '/api/status') return json({ mqttConnected: true });
    return { ok: false, status: 503 };
  }));
  render(<App />);
  fireEvent.click(screen.getByText('Accessible controls'));
  expect(await screen.findByRole('button', { name: 'Clear fault fault-1 for Floor 1 — Office sensor (sensor-0)' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Clear fault fault-2 for Floor 1 — Office sensor (sensor-1)' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Clear fault fault-3 for unknown-sensor' })).toBeTruthy();
});
