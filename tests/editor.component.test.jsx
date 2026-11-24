import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import BuildingEditor from '../src/Devices.Simulator.Web/frontend/editor/BuildingEditor';

const design = {
  revision: 1, width: 20, depth: 20,
  floors: [{ id: 'floor-1', number: 1, controllerId: 'controller-1', controllerX: 0, controllerZ: 0, rooms: [] }]
};
const state = (value = design, editRevision = 1) => ({
  design: value, activeDesign: value, editRevision, activationStatus: 'active', cleanup: []
});
const response = (value, status = 200) => ({
  ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(value)
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function openEditor(request, onActivated = () => {}) {
  const unsubscribe = vi.fn();
  render(<BuildingEditor mutationAccess={{ editorAllowed: true, editorMessage: 'Available', request, subscribe: () => unsubscribe }} onActivated={onActivated} />);
  fireEvent.click(screen.getByRole('button', { name: 'Open building menu' }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Edit building' }));
  await screen.findByRole('button', { name: 'Save and activate' });
  return unsubscribe;
}

describe('building editor', () => {
  it('keeps technical status details expandable and exposes cleanup problems', async () => {
    const request = vi.fn(async () => response({
      ...state(), cleanup: [{ controllerId: 'old-controller', activeRevision: 1, status: 'Failed' }]
    }));
    await openEditor(request);
    expect(screen.getByText(/Controller cleanup needs attention/)).toBeTruthy();
    const details = screen.getByText('Design status details').closest('details');
    expect(details.open).toBe(false);
    expect(within(details).getByText(/1 failed/)).toBeTruthy();
    fireEvent.click(screen.getByText('Design status details'));
    expect(details.open).toBe(true);
  });

  it('zooms the plan and keeps the selected item action alongside it', async () => {
    const withRoom = structuredClone(design);
    withRoom.floors[0].rooms = [{
      id: 'room-1', name: 'Reception Office', x: 4, z: 4, width: 2, depth: 2,
      sensor: { id: 'sensor-1', x: 5, z: 5, controllerId: 'controller-1' },
      doors: [], lights: []
    }];
    await openEditor(vi.fn(async () => response(state(withRoom))));
    const plan = screen.getByRole('img', { name: 'Floor plan' });
    const original = plan.getAttribute('viewBox');
    expect(screen.getByRole('button', { name: 'Delete selected item' }).disabled).toBe(true);
    const label = within(plan).getByText('Reception Office');
    const clipId = label.getAttribute('clip-path').slice(5, -1);
    expect(document.getElementById(clipId).querySelector('rect').getAttribute('width')).toBe('2');
    fireEvent.click(screen.getByRole('button', { name: 'Room: Reception Office' }));
    expect(screen.getByText('Selected: Room: Reception Office')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete selected item' }).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(plan.getAttribute('viewBox')).not.toBe(original);
    expect(screen.getByText('Plan zoom: 150%')).toBeTruthy();
    const zoomed = plan.getAttribute('viewBox');
    fireEvent.click(screen.getByRole('button', { name: 'Pan right' }));
    expect(plan.getAttribute('viewBox')).not.toBe(zoomed);
    expect(screen.getByRole('button', { name: 'Pan right' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Fit all' }));
    expect(plan.getAttribute('viewBox')).toBe(original);
  });

  it('switches between named plan tools without leaving the toolbar unselected', async () => {
    await openEditor(vi.fn(async () => response(state())));
    const toolbar = screen.getByRole('toolbar', { name: 'Plan tool' });
    const select = within(toolbar).getByRole('button', { name: 'Select' });
    const room = within(toolbar).getByRole('button', { name: 'Add room' });
    expect(select.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Active tool: Select')).toBeTruthy();
    expect(room.textContent).toBe('');
    fireEvent.mouseOver(room);
    expect((await screen.findByRole('tooltip')).textContent).toBe('Add room');
    select.focus();
    fireEvent.keyDown(select, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(within(toolbar).getByRole('button', { name: 'Move selected item' }));
    fireEvent.click(room);
    expect(room.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Active tool: Add room')).toBeTruthy();
    expect(select.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(room);
    expect(room.getAttribute('aria-pressed')).toBe('true');
  });

  it('draws connected devices using right-angled plan routes', async () => {
    const withRoom = structuredClone(design);
    withRoom.floors[0].controllerX = 1;
    withRoom.floors[0].controllerZ = 2;
    withRoom.floors[0].rooms = [{
      id: 'room-1', name: 'Office', x: 4, z: 4, width: 4, depth: 4,
      sensor: { id: 'sensor-1', x: 5, z: 6, controllerId: 'controller-1' },
      doors: [], lights: [{ id: 'light-1', x: 6, z: 7, controllerId: null }]
    }];
    await openEditor(vi.fn(async () => response(state(withRoom))));
    const plan = document.querySelector('svg.editor-plan');
    expect(plan.querySelector('.editor-sensor-wire').getAttribute('points')).toBe('1,2 5,2 5,6');
    expect(plan.querySelector('.editor-light-wire')).toBeNull();
  });

  it('shows doors as wall-aligned rectangles and the controller as a selectable box', async () => {
    const withRoom = structuredClone(design);
    withRoom.floors[0].rooms = [{
      id: 'room-1', name: 'Office', x: 4, z: 4, width: 4, depth: 4,
      sensor: { id: 'sensor-1', x: 5, z: 5, controllerId: 'controller-1' },
      doors: [{ id: 'door-1', x: 4, z: 6 }, { id: 'door-2', x: 6, z: 4 }], lights: []
    }];
    await openEditor(vi.fn(async () => response(state(withRoom))));
    const doors = [...document.querySelectorAll('svg.editor-plan rect.editor-door')];
    expect(doors).toHaveLength(2);
    expect(Number(doors[0].getAttribute('height'))).toBeGreaterThan(Number(doors[0].getAttribute('width')));
    expect(Number(doors[1].getAttribute('width'))).toBeGreaterThan(Number(doors[1].getAttribute('height')));
    fireEvent.click(doors[0]);
    expect(screen.getByRole('heading', { name: 'Properties: Door 1: Office' })).toBeTruthy();
    const controller = document.querySelector('svg.editor-plan rect.editor-controller');
    expect(controller).toBeTruthy();
    fireEvent.click(controller);
    expect(screen.getByRole('heading', { name: 'Properties: Floor controller' })).toBeTruthy();
  });

  it('starts a blank design only after confirmation and supports undo', async () => {
    const withRoom = structuredClone(design);
    withRoom.floors[0].rooms.push({
      id: 'room-1', name: 'Office', x: 0, z: 0, width: 2, depth: 2,
      sensor: { id: 'sensor-1', x: 1, z: 1, controllerId: 'controller-1' },
      doors: [], lights: []
    });
    const request = vi.fn(async () => response(state(withRoom)));
    await openEditor(request);
    fireEvent.change(screen.getByRole('textbox', { name: 'Room name' }), { target: { value: 'Unapplied name' } });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole('button', { name: 'Start blank' }));
    expect(screen.getByRole('button', { name: 'Room: Office' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Room name' }).value).toBe('Unapplied name');
    fireEvent.click(screen.getByRole('button', { name: 'Start blank' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Room: Office' })).toBeNull());
    expect(screen.getByRole('textbox', { name: 'Room name' }).value).toBe('New room');
    expect(screen.getByText('Unsaved changes are only kept in this editor until saved.', { exact: false })).toBeTruthy();
    expect(request.mock.calls.some(([url]) => url.endsWith('/save'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByRole('button', { name: 'Room: Office' })).toBeTruthy();
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('uses the default template as an unsaved four-floor design', async () => {
    const template = structuredClone(design);
    for (let number = 2; number <= 4; number++)
      template.floors.push({ id: `floor-${number}`, number, controllerId: `controller-${number}`,
        controllerX: 0, controllerZ: 0, rooms: [] });
    const request = vi.fn(async url => response(url.endsWith('/default-design') ? template : state()));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await openEditor(request);
    fireEvent.click(screen.getByRole('button', { name: 'Start with default building' }));
    await waitFor(() => expect(screen.getByRole('spinbutton', { name: 'Number of floors' }).value).toBe('4'));
    expect(request.mock.calls.some(([url]) => url.endsWith('/save'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByRole('spinbutton', { name: 'Number of floors' }).value).toBe('1');
  });

  it('keeps edits and reports a default template request failure', async () => {
    const request = vi.fn(async url => url.endsWith('/default-design')
      ? response({ detail: 'Template unavailable' }, 503) : response(state()));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await openEditor(request);
    fireEvent.change(screen.getByRole('textbox', { name: 'Room name' }), { target: { value: 'Unapplied name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start with default building' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Template unavailable/);
    expect(screen.getByRole('textbox', { name: 'Room name' }).value).toBe('Unapplied name');
    expect(screen.getByRole('spinbutton', { name: 'Number of floors' }).value).toBe('1');
  });

  it('places, edits, deletes and restores access objects through the list and forms', async () => {
    const withFloors = structuredClone(design);
    withFloors.floors[0].walkways = [];
    withFloors.floors[0].stairs = [];
    withFloors.floors.push({
      id: 'floor-2', number: 2, controllerId: 'controller-2',
      controllerX: 0, controllerZ: 0, rooms: [], walkways: [], stairs: []
    });
    const request = vi.fn(async (url, options) => url.endsWith('/save')
      ? response(state({ ...JSON.parse(options.body).design, revision: 2 }, 2))
      : response(state(withFloors)));
    await openEditor(request);
    fireEvent.click(screen.getByRole('button', { name: 'Add walkway at origin' }));
    expect(screen.getByRole('button', { name: 'Walkway 1' }).getAttribute('aria-pressed')).toBe('true');
    let properties = document.querySelector('[data-form="properties"]');
    fireEvent.change(within(properties).getByRole('spinbutton', { name: 'Width (m)' }), { target: { value: '3.5' } });
    fireEvent.submit(properties);
    expect(document.querySelector('.editor-walkway').getAttribute('width')).toBe('3.5');
    fireEvent.click(screen.getByRole('button', { name: 'Add stairs at origin' }));
    expect(screen.getByRole('button', { name: 'Stairs 1: up to floor 2' }).getAttribute('aria-pressed')).toBe('true');
    properties = document.querySelector('[data-form="properties"]');
    fireEvent.change(within(properties).getByRole('spinbutton', { name: 'X (m)' }), { target: { value: '5' } });
    fireEvent.submit(properties);
    expect(document.querySelector('.editor-stair').getAttribute('x')).toBe('5');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected item' }));
    expect(document.querySelector('.editor-stair')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(document.querySelector('.editor-stair').getAttribute('x')).toBe('5');
    fireEvent.click(screen.getByRole('button', { name: 'Save and activate' }));
    await waitFor(() => expect(request.mock.calls.some(([url]) => url.endsWith('/save'))).toBe(true));
    const saved = JSON.parse(request.mock.calls.find(([url]) => url.endsWith('/save'))[1].body).design;
    expect(saved.floors[0].walkways[0].width).toBe(3.5);
    expect(saved.floors[0].stairs[0]).toMatchObject({ x: 5, direction: 'east' });
  });

  it('shows legacy access and the incoming stairs on the next floor', async () => {
    const legacy = structuredClone(design);
    legacy.floors.push({ id: 'floor-2', number: 2, controllerId: 'controller-2', controllerX: 0, controllerZ: 0, rooms: [] });
    await openEditor(vi.fn(async () => response(state(legacy))));
    expect(document.querySelectorAll('.editor-walkway')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Stairs 1: up to floor 2' })).toBeTruthy();
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Floor' }));
    fireEvent.click(screen.getByRole('option', { name: 'Floor 2' }));
    expect(document.querySelectorAll('.editor-stair-incoming')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Stairs 1: down to floor 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add stairs at origin' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Stairs 1: down to floor 1' }));
    expect(screen.getByRole('heading', { name: 'Properties: Stairs 1' })).toBeTruthy();
  });

  it('focuses the validation message when stairs must be removed from the top floor', async () => {
    const invalid = structuredClone(design);
    invalid.floors[0].walkways = [];
    invalid.floors[0].stairs = [{ id: 'stair-1', x: 0, z: 0, width: 2, depth: 1, direction: 'east' }];
    await openEditor(vi.fn(async () => response(state(invalid))));
    fireEvent.click(screen.getByRole('button', { name: 'Save and activate' }));
    const error = await screen.findByRole('alert');
    expect(error.textContent).toMatch(/stairs/i);
    expect(document.activeElement).toBe(error);
    expect(screen.getByRole('button', { name: 'Delete selected item' }).disabled).toBe(false);
  });

  it('identifies a selected door when confirming its deletion', async () => {
    const withRoom = structuredClone(design);
    withRoom.floors[0].rooms = [{
      id: 'room-1', name: 'Office', x: 4, z: 4, width: 4, depth: 4,
      sensor: { id: 'sensor-1', x: 5, z: 6, controllerId: 'controller-1' },
      doors: [{ id: 'door-1', x: 4, z: 5 }], lights: []
    }];
    await openEditor(vi.fn(async () => response(state(withRoom))));
    fireEvent.click(screen.getByRole('button', { name: 'Door 1: Office' }));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected item' }));
    expect(confirm).toHaveBeenCalledWith('Delete Door 1: Office?');
    expect(screen.queryByRole('button', { name: 'Door 1: Office' })).toBeNull();
  });

  it('uses the toolbar to place and move plan items and reports a missing room', async () => {
    await openEditor(vi.fn(async () => response(state())));
    const toolbar = screen.getByRole('toolbar', { name: 'Plan tool' });
    const plan = document.querySelector('svg.editor-plan');
    plan.getScreenCTM = () => ({ inverse: () => ({}) });
    plan.createSVGPoint = () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } });
    const choose = name => fireEvent.click(within(toolbar).getByRole('button', { name }));
    choose('Add door');
    fireEvent.click(plan, { clientX: 4, clientY: 4 });
    expect(screen.getByRole('alert').textContent).toContain('Choose Select and select a room');
    choose('Add room');
    fireEvent.click(plan, { clientX: 4, clientY: 4 });
    const roomButton = await screen.findByRole('button', { name: 'Room: New room' });
    choose('Select');
    fireEvent.click(roomButton);
    choose('Add door');
    fireEvent.click(plan, { clientX: 4, clientY: 5 });
    expect(document.querySelectorAll('svg.editor-plan rect.editor-door')).toHaveLength(1);
    choose('Add light');
    fireEvent.click(plan, { clientX: 5, clientY: 5 });
    expect(document.querySelectorAll('svg.editor-plan circle.editor-light')).toHaveLength(1);
    choose('Move selected item');
    fireEvent.click(plan, { clientX: 8, clientY: 8 });
    expect(document.querySelector('svg.editor-plan rect.editor-selected').getAttribute('x')).toBe('8');
    expect(document.querySelector('svg.editor-plan circle.editor-light').getAttribute('cx')).toBe('9');
  });

  it('previews a room drag and commits its fixtures as one undoable change', async () => {
    vi.stubGlobal('PointerEvent', class extends MouseEvent {
      constructor(type, options) {
        super(type, options);
        this.pointerId = options.pointerId;
        this.isPrimary = options.isPrimary ?? true;
      }
    });
    await openEditor(vi.fn(async () => response(state())));
    fireEvent.submit(document.querySelector('[data-form="new-room"]'));
    const plan = document.querySelector('svg.editor-plan');
    plan.getScreenCTM = () => ({ inverse: () => ({}) });
    plan.createSVGPoint = () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } });
    plan.setPointerCapture = vi.fn();
    plan.hasPointerCapture = () => false;
    const room = plan.querySelector('.editor-room');
    const sensorStart = plan.querySelector('.editor-sensor').getAttribute('cx');
    fireEvent.pointerDown(room, { pointerId: 1, button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(plan, { pointerId: 1, clientX: 8, clientY: 8 });
    expect(plan.querySelector('.editor-drag-preview rect').getAttribute('x')).toBe('8');
    expect(room.getAttribute('x')).toBe('0');
    fireEvent.pointerUp(plan, { pointerId: 1, clientX: 8, clientY: 8 });
    expect(plan.querySelector('.editor-room').getAttribute('x')).toBe('8');
    expect(Number(plan.querySelector('.editor-sensor').getAttribute('cx'))).toBe(Number(sensorStart) + 8);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(plan.querySelector('.editor-room').getAttribute('x')).toBe('0');
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect(plan.querySelector('.editor-room').getAttribute('x')).toBe('8');
  });

  it.each([
    ['controller', 'cx', 0, 0, 5, 0, '5'],
    ['sensor', 'cx', 1, 1, 6, 1, '6'],
    ['door', 'cy', 0, 5, 0, 10, '10']
  ])('moves and undoes a valid %s drag', async (kind, attribute, x, y, endX, endY, expected) => {
    vi.stubGlobal('PointerEvent', class extends MouseEvent {
      constructor(type, options) {
        super(type, options);
        this.pointerId = options.pointerId;
        this.isPrimary = options.isPrimary ?? true;
      }
    });
    const withRoom = structuredClone(design);
    withRoom.floors[0].rooms = [{
      id: 'room-1', name: 'Office', x: 0, z: 0, width: 10, depth: 10,
      sensor: { id: 'sensor-1', x: 1, z: 1, controllerId: 'controller-1' },
      doors: [{ id: 'door-1', x: 0, z: 5 }], lights: []
    }];
    await openEditor(vi.fn(async () => response(state(withRoom))));
    const plan = document.querySelector('svg.editor-plan');
    plan.getScreenCTM = () => ({ inverse: () => ({}) });
    plan.createSVGPoint = () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } });
    plan.setPointerCapture = vi.fn();
    plan.hasPointerCapture = () => false;
    const item = plan.querySelector(`.editor-${kind}`);
    const position = element => element.tagName.toLowerCase() === 'rect'
      ? Number(element.getAttribute(attribute === 'cx' ? 'x' : 'y')) +
        Number(element.getAttribute(attribute === 'cx' ? 'width' : 'height')) / 2
      : Number(element.getAttribute(attribute));
    const original = position(item);
    fireEvent.pointerDown(item, { pointerId: 1, button: 0, clientX: x, clientY: y });
    fireEvent.pointerMove(plan, { pointerId: 1, clientX: endX, clientY: endY });
    fireEvent.pointerUp(plan, { pointerId: 1, clientX: endX, clientY: endY });
    expect(position(item)).toBeCloseTo(Number(expected));
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(position(plan.querySelector(`.editor-${kind}`))).toBeCloseTo(original);
  });

  it('cancels a drag and preserves unapplied form values when movement is declined', async () => {
    vi.stubGlobal('PointerEvent', class extends MouseEvent {
      constructor(type, options) {
        super(type, options);
        this.pointerId = options.pointerId;
        this.isPrimary = options.isPrimary ?? true;
      }
    });
    await openEditor(vi.fn(async () => response(state())));
    fireEvent.submit(document.querySelector('[data-form="new-room"]'));
    fireEvent.click(await screen.findByRole('button', { name: 'Room: New room' }));
    const name = within(document.querySelector('[data-form="properties"]')).getByRole('textbox', { name: 'Room name' });
    fireEvent.change(name, { target: { value: 'Unapplied name' } });
    const plan = document.querySelector('svg.editor-plan');
    plan.getScreenCTM = () => ({ inverse: () => ({}) });
    plan.createSVGPoint = () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } });
    plan.setPointerCapture = vi.fn();
    plan.hasPointerCapture = () => false;
    const room = plan.querySelector('.editor-room');
    fireEvent.pointerDown(room, { pointerId: 1, button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(plan, { pointerId: 1, clientX: 8, clientY: 8 });
    fireEvent.pointerCancel(plan, { pointerId: 1 });
    expect(plan.querySelector('.editor-drag-preview')).toBeNull();
    expect(room.getAttribute('x')).toBe('0');
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.pointerDown(room, { pointerId: 2, button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(plan, { pointerId: 2, clientX: 8, clientY: 8 });
    fireEvent.pointerUp(plan, { pointerId: 2, clientX: 8, clientY: 8 });
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(room.getAttribute('x')).toBe('0');
    expect(name.value).toBe('Unapplied name');
  });

  it('does not turn a cancelled drag into a click-to-move action', async () => {
    vi.stubGlobal('PointerEvent', class extends MouseEvent {
      constructor(type, options) {
        super(type, options);
        this.pointerId = options.pointerId;
        this.isPrimary = options.isPrimary ?? true;
      }
    });
    await openEditor(vi.fn(async () => response(state())));
    fireEvent.submit(document.querySelector('[data-form="new-room"]'));
    fireEvent.click(await screen.findByRole('button', { name: 'Room: New room' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move selected item' }));
    const plan = document.querySelector('svg.editor-plan');
    plan.getScreenCTM = () => ({ inverse: () => ({}) });
    plan.createSVGPoint = () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } });
    plan.setPointerCapture = vi.fn();
    plan.hasPointerCapture = () => false;
    for (const cancel of ['escape', 'lost-capture']) {
      fireEvent.pointerDown(plan.querySelector('.editor-room'), { pointerId: 1, button: 0, clientX: 0, clientY: 0 });
      fireEvent.pointerMove(plan, { pointerId: 1, clientX: 8, clientY: 8 });
      if (cancel === 'escape') fireEvent.keyDown(window, { key: 'Escape' });
      else fireEvent.lostPointerCapture(plan, { pointerId: 1 });
      fireEvent.pointerUp(plan, { pointerId: 1, clientX: 8, clientY: 8 });
      fireEvent.click(plan, { clientX: 8, clientY: 8 });
      expect(plan.querySelector('.editor-room').getAttribute('x')).toBe('0');
    }
  });

  it('selects on tap and reports invalid device positions after dragging', async () => {
    vi.stubGlobal('PointerEvent', class extends MouseEvent {
      constructor(type, options) {
        super(type, options);
        this.pointerId = options.pointerId;
        this.isPrimary = options.isPrimary ?? true;
      }
    });
    const withRoom = structuredClone(design);
    withRoom.floors[0].rooms = [{
      id: 'room-1', name: 'Office', x: 0, z: 0, width: 10, depth: 10,
      sensor: { id: 'sensor-1', x: 1, z: 1, controllerId: 'controller-1' },
      doors: [], lights: [{ id: 'light-1', x: 2, z: 2, controllerId: 'controller-1' }]
    }];
    await openEditor(vi.fn(async () => response(state(withRoom))));
    const plan = document.querySelector('svg.editor-plan');
    plan.getScreenCTM = () => ({ inverse: () => ({}) });
    plan.createSVGPoint = () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } });
    plan.setPointerCapture = vi.fn();
    plan.hasPointerCapture = () => false;
    const light = plan.querySelector('.editor-light');
    fireEvent.pointerDown(light, { pointerId: 1, button: 0, clientX: 2, clientY: 2 });
    fireEvent.pointerUp(plan, { pointerId: 1, clientX: 2, clientY: 2 });
    fireEvent.click(plan);
    expect(screen.getByRole('heading', { name: /Properties: Light 1: Office/ })).toBeTruthy();
    fireEvent.pointerDown(light, { pointerId: 2, button: 0, clientX: 2, clientY: 2 });
    fireEvent.pointerUp(plan, { pointerId: 3, clientX: 15, clientY: 2 });
    fireEvent.pointerMove(plan, { pointerId: 2, clientX: 15, clientY: 2 });
    fireEvent.pointerUp(plan, { pointerId: 2, clientX: 15, clientY: 2 });
    expect(plan.querySelector('.editor-light').getAttribute('cx')).toBe('15');
    expect(screen.getByRole('alert').textContent).toContain('The move leaves a design validation issue');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(plan.querySelector('.editor-light').getAttribute('cx')).toBe('2');
  });

  it('preserves invalid unapplied values in a recovery export and accepts corrected values', async () => {
    const request = vi.fn(async (url, options) => response(url.endsWith('/save')
      ? state(JSON.parse(options.body).design, 2) : state()));
    const createObjectURL = vi.fn(() => 'blob:recovery');
    vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL, revokeObjectURL: vi.fn() }));
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await openEditor(request);
    const width = screen.getByRole('spinbutton', { name: 'Building width (m)' });
    fireEvent.change(width, { target: { value: '1' } });
    expect(width.getAttribute('aria-invalid')).toBe('true');
    fireEvent.submit(width.closest('form'));
    expect(screen.getByRole('alert').textContent).toContain('Enter a number within the allowed range');
    fireEvent.click(screen.getByRole('button', { name: 'Export local design' }));
    expect(screen.getByRole('alert').textContent).toContain('Downloaded recovery JSON');
    const blob = createObjectURL.mock.calls[0][0];
    const exported = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(JSON.parse(reader.result));
      reader.onerror = reject;
      reader.readAsText(blob);
    });
    expect(exported).toMatchObject({
      format: 'building-editor-recovery', validatedDesign: false, design: { width: 20 },
      pendingForms: [{ form: 'building', fields: expect.arrayContaining([expect.objectContaining({ name: 'width', value: '1' })]) }]
    });
    fireEvent.change(width, { target: { value: '22' } });
    fireEvent.click(within(width.closest('form')).getByRole('button', { name: 'Apply' }));
    expect(screen.getByText(/Unsaved changes are only kept/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save and activate' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('/api/building-editor/save', expect.objectContaining({
      method: 'POST', body: expect.stringContaining('"width":22')
    }), true));
    await screen.findByText(/Saved design/);
  });

  it('blocks saving on conflict until the user discards local changes and reloads', async () => {
    const current = { ...design, width: 24, revision: 2 };
    let reads = 0;
    const request = vi.fn(async url => {
      if (url.endsWith('/save')) return response({ detail: 'Revision conflict' }, 409);
      return response(++reads === 1 ? state() : state(current, 2));
    });
    const unsubscribe = await openEditor(request);
    const width = screen.getByRole('spinbutton', { name: 'Building width (m)' });
    fireEvent.change(width, { target: { value: '22' } });
    fireEvent.click(within(width.closest('form')).getByRole('button', { name: 'Apply' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save and activate' }));
    await screen.findByText(/The saved design changed/);
    expect(screen.getByRole('button', { name: 'Save and activate' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Export local design' }).disabled).toBe(false);
    expect(width.value).toBe('22');
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const reload = screen.getByRole('button', { name: 'Discard local changes and load saved design' });
    fireEvent.click(reload);
    expect(reads).toBe(1);
    fireEvent.click(reload);
    await waitFor(() => expect(screen.getByRole('spinbutton', { name: 'Building width (m)' }).value).toBe('24'));
    expect(screen.getByRole('button', { name: 'Save and activate' }).disabled).toBe(false);
    cleanup();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('keeps applied and unapplied edits after failed conflict recovery and loads current state on retry', async () => {
    let reads = 0;
    const request = vi.fn(async url => {
      if (url.endsWith('/save')) return response({ detail: 'Revision conflict' }, 409);
      reads++;
      if (reads === 2) throw new Error('Recovery unavailable');
      return reads === 1 ? response(state()) : response(state({ ...design, width: 24, revision: 2 }, 2));
    });
    await openEditor(request);
    const width = screen.getByRole('spinbutton', { name: 'Building width (m)' });
    const depth = screen.getByRole('spinbutton', { name: 'Building depth (m)' });
    fireEvent.change(width, { target: { value: '22' } });
    fireEvent.click(within(width.closest('form')).getByRole('button', { name: 'Apply' }));
    fireEvent.change(depth, { target: { value: '21' } });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Save and activate' }));
    await screen.findByText(/The saved design changed/);
    const recover = screen.getByRole('button', { name: 'Discard local changes and load saved design' });
    fireEvent.click(recover);
    await screen.findByText(/Recovery unavailable/);
    expect(width.value).toBe('22');
    expect(depth.value).toBe('21');
    expect(screen.getByRole('button', { name: 'Save and activate' }).disabled).toBe(true);
    fireEvent.click(recover);
    await waitFor(() => expect(screen.getByRole('spinbutton', { name: 'Building width (m)' }).value).toBe('24'));
    expect(screen.getByRole('button', { name: 'Save and activate' }).disabled).toBe(false);
  });

  it('undoes and redoes applied edits without saving them', async () => {
    const request = vi.fn(async () => response(state()));
    await openEditor(request);
    const width = screen.getByRole('spinbutton', { name: 'Building width (m)' });
    fireEvent.change(width, { target: { value: '22' } });
    fireEvent.click(within(width.closest('form')).getByRole('button', { name: 'Apply' }));
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(width.value).toBe('20');
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect(width.value).toBe('22');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('adds, selects, moves, and deletes an item through the form and visible plan/list selection', async () => {
    const request = vi.fn(async () => response(state()));
    await openEditor(request);
    expect(screen.getByRole('button', { name: 'Delete selected item' }).disabled).toBe(true);
    fireEvent.submit(document.querySelector('[data-form="new-room"]'));

    const roomButton = await screen.findByRole('button', { name: 'Room: New room' });
    fireEvent.click(roomButton);
    expect(roomButton.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Delete selected item' }).disabled).toBe(false);
    expect(document.querySelector('svg.editor-plan rect.editor-selected')?.getAttribute('x')).toBe('0');
    expect(screen.getByRole('heading', { name: 'Properties: Room: New room' })).toBeTruthy();

    const properties = document.querySelector('[data-form="properties"]');
    fireEvent.change(within(properties).getByRole('spinbutton', { name: 'X (m)' }), { target: { value: '8' } });
    fireEvent.change(within(properties).getByRole('spinbutton', { name: 'Z (m)' }), { target: { value: '8' } });
    fireEvent.submit(properties);
    expect(document.querySelector('svg.editor-plan rect.editor-selected')?.getAttribute('x')).toBe('8');

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected item' }));
    expect(screen.queryByRole('button', { name: 'Room: New room' })).toBeNull();
    expect(document.querySelector('svg.editor-plan .editor-selected')).toBeNull();
    expect(document.querySelector('[data-form="properties"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByRole('button', { name: 'Room: New room' })).toBeTruthy();
  });

  it('keeps a successful save distinct from a failed live simulator refresh', async () => {
    const request = vi.fn(async (url, options) => response(url.endsWith('/save')
      ? state(JSON.parse(options.body).design, 2) : state()));
    const onActivated = vi.fn().mockRejectedValue(new Error('Controller snapshot unavailable'));
    await openEditor(request, onActivated);
    const width = screen.getByRole('spinbutton', { name: 'Building width (m)' });
    fireEvent.change(width, { target: { value: '22' } });
    fireEvent.click(within(width.closest('form')).getByRole('button', { name: 'Apply' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save and activate' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('The design is saved, but the live simulator could not be refreshed');
    expect(alert.textContent).toContain('Controller snapshot unavailable');
    expect(alert.textContent).not.toContain('Save failed');
    expect(request.mock.calls.filter(([url]) => url.endsWith('/save'))).toHaveLength(1);
    expect(screen.queryByText('Unsaved changes are only kept in this editor until saved.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Save and activate' }).disabled).toBe(false);
    expect(onActivated).toHaveBeenCalledOnce();
  });

  it('retries activation and controller cleanup and reflects the refreshed status', async () => {
    let activationRetried = false;
    let cleanupRetried = false;
    const request = vi.fn(async (url, options = {}) => {
      if (url.endsWith('/retry')) activationRetried = true;
      if (url.endsWith('/retry-cleanup')) cleanupRetried = true;
      if (url === '/api/building-editor') {
        return response({
          ...state(),
          activationStatus: activationRetried ? 'active' : 'failed',
          cleanup: cleanupRetried ? [{ status: 'completed' }] : [{ status: 'pending' }]
        });
      }
      return response(state());
    });
    const onActivated = vi.fn();
    await openEditor(request, onActivated);

    fireEvent.click(screen.getByRole('button', { name: 'Retry activation' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('/api/building-editor/retry', expect.objectContaining({ method: 'POST' }), true));
    expect(onActivated).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Retry activation' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry controller cleanup' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Retry controller cleanup' }));
    await waitFor(() => expect(request).toHaveBeenCalledWith('/api/building-editor/retry-cleanup', expect.objectContaining({ method: 'POST' }), true));
    expect(screen.queryByRole('button', { name: 'Retry controller cleanup' })).toBeNull();
  });
});
