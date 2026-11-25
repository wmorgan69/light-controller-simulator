import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import BuildingEditor from '../src/Devices.BuildingControl.Web/frontend/editor/BuildingEditor';

const access = (allowed, message, request = vi.fn()) => ({
  editorAllowed: allowed, editorMessage: message, request, subscribe: () => () => {}
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it.each(['Escape', 'backdrop'])('restores focus before hiding the menu on %s', async close => {
  const hiddenFocusedElements = [];
  const setAttribute = Element.prototype.setAttribute;
  vi.spyOn(Element.prototype, 'setAttribute').mockImplementation(function (name, value) {
    if (name === 'aria-hidden' && String(value) === 'true' && this.querySelector('[role="menu"]') && this.contains(document.activeElement)) {
      hiddenFocusedElements.push(this);
    }
    return setAttribute.call(this, name, value);
  });
  render(<BuildingEditor mutationAccess={access(true, 'Available')} />);
  const trigger = screen.getByRole('button', { name: 'Open building menu' });
  trigger.focus();
  fireEvent.click(trigger);
  const item = screen.getByRole('menuitem', { name: 'Edit building' });
  await waitFor(() => expect(document.activeElement).toBe(item));
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  if (close === 'backdrop') fireEvent.click(document.querySelector('.MuiBackdrop-root'));
  else fireEvent.keyDown(item, { key: close });
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  await waitFor(() => expect(screen.queryByRole('menu', { hidden: true })).toBeNull());
  expect(hiddenFocusedElements).toEqual([]);
});

it.each([
  ['Tab', false, 'Next control'],
  ['Shift+Tab', true, 'Previous control']
])('moves focus to the adjacent tabbable control on %s', async (_key, shiftKey, expected) => {
  const hiddenFocusedElements = [];
  const setAttribute = Element.prototype.setAttribute;
  vi.spyOn(Element.prototype, 'setAttribute').mockImplementation(function (name, value) {
    if (name === 'aria-hidden' && String(value) === 'true' && this.querySelector('[role="menu"]') && this.contains(document.activeElement)) {
      hiddenFocusedElements.push(this);
    }
    return setAttribute.call(this, name, value);
  });
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}]);
  render(<>
    <button>Previous control</button>
    <button disabled>Disabled control</button>
    <BuildingEditor mutationAccess={access(true, 'Available')} />
    <button hidden>Hidden control</button>
    <button>Next control</button>
  </>);
  const trigger = screen.getByRole('button', { name: 'Open building menu' });
  trigger.focus();
  fireEvent.click(trigger);
  const item = screen.getByRole('menuitem', { name: 'Edit building' });
  await waitFor(() => expect(document.activeElement).toBe(item));
  fireEvent.keyDown(item, { key: 'Tab', shiftKey });
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: expected })));
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(hiddenFocusedElements).toEqual([]);
});

it('uses tab index order rather than document order', async () => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}]);
  render(<>
    <button>Normal control</button>
    <button tabIndex={2}>Second priority</button>
    <button tabIndex={1}>First priority</button>
    <BuildingEditor mutationAccess={access(true, 'Available')} />
  </>);
  const trigger = screen.getByRole('button', { name: 'Open building menu' });
  trigger.focus();
  fireEvent.click(trigger);
  fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Edit building' }), { key: 'Tab', shiftKey: true });
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Normal control' })));
});

it('skips unchecked radios when a radio group has a selected item', async () => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}]);
  render(<>
    <BuildingEditor mutationAccess={access(true, 'Available')} />
    <label><input type="radio" name="choice" /> First</label>
    <label><input type="radio" name="choice" defaultChecked /> Selected</label>
  </>);
  const trigger = screen.getByRole('button', { name: 'Open building menu' });
  trigger.focus();
  fireEvent.click(trigger);
  fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Edit building' }), { key: 'Tab' });
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Selected' })));
});

it('does not steal focus if the user moves it while the menu closes', async () => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}]);
  render(<>
    <BuildingEditor mutationAccess={access(true, 'Available')} />
    <button>Next control</button>
    <button>Other control</button>
  </>);
  const trigger = screen.getByRole('button', { name: 'Open building menu' });
  trigger.focus();
  fireEvent.click(trigger);
  fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Edit building' }), { key: 'Tab' });
  const other = screen.getByRole('button', { name: 'Other control' });
  other.focus();
  await waitFor(() => expect(screen.queryByRole('menu', { hidden: true })).toBeNull());
  expect(document.activeElement).toBe(other);
});

it('leaves the trigger when there is no preceding tabbable control', async () => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}]);
  render(<BuildingEditor mutationAccess={access(false, 'View only')} />);
  const trigger = screen.getByRole('button', { name: 'Open building menu' });
  trigger.focus();
  fireEvent.click(trigger);
  const item = screen.getByRole('menuitem', { name: 'Edit building' });
  await waitFor(() => expect(document.activeElement).toBe(item));
  fireEvent.keyDown(item, { key: 'Tab', shiftKey: true });
  await waitFor(() => expect(document.activeElement).toBe(document.body));
});

it('explains unavailable access in the menu and does not request the editor', () => {
  const request = vi.fn();
  render(<BuildingEditor mutationAccess={access(false, 'View only', request)} />);
  expect(screen.getByRole('status').textContent).toBe('View only');
  fireEvent.click(screen.getByRole('button', { name: 'Open building menu' }));
  const item = screen.getByRole('menuitem', { name: 'Edit building' });
  expect(item.getAttribute('aria-disabled')).toBe('true');
  expect(document.getElementById(item.getAttribute('aria-describedby')).textContent).toBe('View only');
  fireEvent.click(item);
  expect(request).not.toHaveBeenCalled();
});

it('updates an open menu when server-backed editor access is revoked', () => {
  const request = vi.fn();
  const { rerender } = render(<BuildingEditor mutationAccess={access(true, 'Available', request)} />);
  fireEvent.click(screen.getByRole('button', { name: 'Open building menu' }));
  expect(screen.getByRole('menuitem', { name: 'Edit building' }).getAttribute('aria-disabled')).not.toBe('true');
  rerender(<BuildingEditor mutationAccess={access(false, 'Access unavailable', request)} />);
  const item = screen.getByRole('menuitem', { name: 'Edit building' });
  expect(item.getAttribute('aria-disabled')).toBe('true');
  expect(document.getElementById(item.getAttribute('aria-describedby')).textContent).toBe('Access unavailable');
  fireEvent.click(item);
  expect(request).not.toHaveBeenCalled();
});
