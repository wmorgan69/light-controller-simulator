import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const scene = vi.hoisted(() => ({ mounts: 0 }));
vi.mock('../src/Devices.BuildingControl.Web/frontend/scene/SceneCanvas', async () => {
  const { useEffect } = await import('react');
  return {
    SceneCanvas: ({ onRendererError, onRendererReady }) => {
      useEffect(() => {
        scene.mounts++;
        if (scene.mounts === 1) onRendererError(new Error('WebGL unavailable'));
        else onRendererReady();
      }, []);
      return null;
    }
  };
});
import { App } from '../src/Devices.BuildingControl.Web/frontend/SimulatorApp';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); scene.mounts = 0; });

it('offers accessible controls when rendering fails and clears the error after retry', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('fetch', vi.fn(async url => {
    if (url === '/api/capabilities') return { ok: true, json: async () => ({ mutationsAllowed: true, editorAllowed: false }) };
    if (url === '/api/building-view') return { ok: true, json: async () => ({ design: null, controllers: [] }) };
    if (url === '/api/status') return { ok: true, json: async () => ({ mqttConnected: false }) };
    return { ok: false, status: 503 };
  }));
  render(<App />);
  expect(await screen.findByRole('group', { name: /3D view unavailable: WebGL unavailable/ })).toBeTruthy();
  expect(screen.getByText('Accessible controls')).toBeTruthy();
  const retry = screen.getByRole('button', { name: /retry 3d/i });
  retry.focus();
  fireEvent.click(retry);
  await waitFor(() => expect(screen.queryByRole('group', { name: /3D view unavailable/ })).toBeNull());
  expect(scene.mounts).toBe(2);
  expect(document.activeElement).toBe(screen.getByRole('region', { name: '3D building view' }));
});
