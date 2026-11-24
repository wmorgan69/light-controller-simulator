import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import BuildingEditor from '../src/Devices.Simulator.Web/frontend/editor/BuildingEditor';

const design = {
  revision: 1, width: 20, depth: 20,
  floors: [{ id: 'floor-1', number: 1, controllerId: 'controller-1', controllerX: 0, controllerZ: 0, rooms: [] }]
};
const state = { design, activeDesign: design, editRevision: 1, activationStatus: 'active', cleanup: [] };
const response = { ok: true, status: 200, text: async () => JSON.stringify(state) };
const access = request => ({ editorAllowed: true, editorMessage: 'Available', request, subscribe: () => () => {} });
const openEditor = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Open building menu' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Edit building' }));
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it.each(['click', 'Enter'])('hands off focus safely on %s activation and restores it only after a confirmed exit', async activation => {
  const hiddenFocusedElements = [];
  const setAttribute = Element.prototype.setAttribute;
  vi.spyOn(Element.prototype, 'setAttribute').mockImplementation(function (name, value) {
    if (name === 'aria-hidden' && String(value) === 'true' && this.querySelector('[role="menu"]') && this.contains(document.activeElement)) {
      hiddenFocusedElements.push(this);
    }
    return setAttribute.call(this, name, value);
  });
  render(<BuildingEditor mutationAccess={access(async () => response)} />);
  const entry = screen.getByRole('button', { name: 'Open building menu' });
  entry.focus();
  fireEvent.click(entry);
  const menu = screen.getByRole('menu');
  const focusHandoff = vi.fn(() => expect(menu.contains(document.activeElement)).toBe(false));
  entry.addEventListener('focus', focusHandoff, { once: true });
  const item = screen.getByRole('menuitem', { name: 'Edit building' });
  if (activation === 'Enter') fireEvent.keyDown(item, { key: 'Enter' });
  else fireEvent.click(item);
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Edit building' })));
  expect(focusHandoff).toHaveBeenCalledOnce();
  expect(screen.queryByRole('menu')).toBeNull();
  expect(hiddenFocusedElements).toEqual([]);
  await screen.findByRole('button', { name: 'Save and activate' });
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Building width (m)' }), { target: { value: '22' } });
  const exit = screen.getByRole('button', { name: 'Exit editor' });
  exit.focus();
  vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
  fireEvent.click(exit);
  expect(document.activeElement).toBe(exit);
  fireEvent.click(exit);
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open building menu' }));
});

it('retains a focus target during failed-load retry and restores the entry on return', async () => {
  let release;
  const retry = new Promise(resolve => { release = resolve; });
  const request = vi.fn().mockRejectedValueOnce(new Error('Unavailable')).mockReturnValueOnce(retry);
  render(<BuildingEditor mutationAccess={access(request)} />);
  openEditor();
  const retryButton = await screen.findByRole('button', { name: 'Retry' });
  expect(document.activeElement).toBe(screen.getByRole('alert'));
  retryButton.focus();
  fireEvent.click(retryButton);
  const heading = screen.getByRole('heading', { name: 'Edit building' });
  expect(document.activeElement).toBe(heading);
  release(response);
  await screen.findByRole('button', { name: 'Save and activate' });
  expect(document.activeElement).toBe(heading);
  fireEvent.click(screen.getByRole('button', { name: 'Exit editor' }));
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open building menu' }));
});

it('focuses the menu trigger on exit even if editor access is lost', async () => {
  const initial = access(async () => response);
  const { rerender } = render(<BuildingEditor mutationAccess={initial} />);
  openEditor();
  await screen.findByRole('button', { name: 'Exit editor' });
  rerender(<BuildingEditor mutationAccess={{ ...initial, editorAllowed: false, editorMessage: 'View only' }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Exit editor' }));
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open building menu' })));
  expect(screen.getByRole('status').textContent).toBe('View only');
});
