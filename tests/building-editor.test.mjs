import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorSession, newFloor, newRoom, validateDesign } from '../src/Devices.Simulator.Web/wwwroot/building-editor-state.mjs';

const clone = value => structuredClone(value);
const makeDesign = () => {
  const floor = newFloor(1);
  floor.rooms.push(newRoom(0, 0, 2, 2, 'Office', floor.controllerId));
  return { revision: 1, width: 20, depth: 20, floors: [floor] };
};
const reply = (value, status = 200) => new Response(value === null ? null : JSON.stringify(value), { status });
function server() {
  const saved = makeDesign();
  const state = { design: clone(saved), activeDesign: clone(saved), editRevision: 1, calls: [], failSave: false };
  const snapshot = () => ({
    design: state.design, activeDesign: state.activeDesign,
    editRevision: state.editRevision, activationStatus: 'active', cleanup: []
  });
  const fetcher = async (url, options) => {
    const body = options.body && JSON.parse(options.body);
    state.calls.push({ url, body, method: options.method, credentials: options.credentials });
    if (url.endsWith('/save')) {
      if (state.failSave) return reply({ detail: 'Disk full' }, 500);
      if (body.expectedRevision !== state.editRevision) return reply({ detail: 'Revision conflict' }, 409);
      state.design = { ...clone(body.design), revision: ++state.editRevision };
      state.activeDesign = clone(state.design);
      return reply(snapshot());
    }
    if (url.endsWith('/building-editor')) return reply(snapshot());
    return reply({});
  };
  return { state, fetcher };
}

test('edits remain local until explicitly saved and reopening starts from saved design', async () => {
  const { state, fetcher } = server();
  const session = new EditorSession(fetcher);
  await session.open();
  session.edit(d => { d.width = 21; });
  session.edit(d => { d.width = 22; });
  assert.equal(state.design.width, 20);
  assert.equal(state.calls.some(c => c.url.endsWith('/save')), false);
  const reopened = new EditorSession(fetcher);
  await reopened.open();
  assert.equal(reopened.design.width, 20);
  await session.save();
  assert.equal(state.calls.find(c => c.url.endsWith('/save')).body.design.width, 22);
  assert.equal(state.calls.find(c => c.url.endsWith('/save')).body.expectedRevision, 1);
  assert.equal(state.calls.some(c => c.url.endsWith('/draft')), false);
  assert.equal(state.design.width, 22);
});

test('save failure preserves local edits for retry', async () => {
  const { state, fetcher } = server();
  const session = new EditorSession(fetcher);
  await session.open();
  state.failSave = true;
  session.edit(d => { d.width = 21; });
  await assert.rejects(session.save(), /Disk full/);
  assert.equal(session.design.width, 21);
  assert.equal(session.dirty, true);
  assert.equal(state.design.width, 20);
  state.failSave = false;
  await session.save();
  assert.equal(session.saved.width, 21);
});

test('concurrent editors can open and stale saves preserve local edits', async () => {
  const { state, fetcher } = server();
  const first = new EditorSession(fetcher), second = new EditorSession(fetcher);
  await Promise.all([first.open(), second.open()]);
  first.edit(d => { d.width = 21; });
  second.edit(d => { d.width = 23; });
  await first.save();
  await assert.rejects(second.save(), /Revision conflict/);
  assert.equal(second.conflict, true);
  assert.equal(second.design.width, 23);
  assert.equal(state.design.width, 21);
  await second.useCurrent();
  assert.equal(second.design.width, 21);
  assert.equal(second.conflict, false);
  assert.equal(state.calls.some(c => c.url.endsWith('/lease')), false);
});

test('a stale revision reports conflict without overwriting the newer saved design', async () => {
  const { state, fetcher } = server();
  const session = new EditorSession(fetcher);
  await session.open();
  state.design = { ...clone(state.design), width: 23, revision: 2 };
  state.editRevision++;
  session.edit(d => { d.width = 21; });
  await assert.rejects(session.save(), /Revision conflict/);
  assert.equal(session.conflict, true);
  assert.equal(session.design.width, 21);
  assert.equal(state.design.width, 23);
  await session.useCurrent();
  assert.equal(session.design.width, 23);
  assert.equal(session.editRevision, state.editRevision);
});

test('failed conflict recovery keeps local edits and allows retry', async () => {
  const { state, fetcher } = server();
  let failRead = false;
  const session = new EditorSession((url, options) =>
    failRead && url.endsWith('/building-editor') ? reply({ detail: 'Offline' }, 503) : fetcher(url, options));
  await session.open();
  session.edit(d => { d.width = 21; });
  state.editRevision++;
  await assert.rejects(session.save(), /Revision conflict/);
  failRead = true;
  await assert.rejects(session.useCurrent(), /Offline/);
  assert.equal(session.design.width, 21);
  assert.equal(session.conflict, true);
  failRead = false;
  await session.useCurrent();
  assert.equal(session.conflict, false);
});

test('retry activation updates running and cleanup status without replacing local edits', async () => {
  const { state, fetcher } = server();
  const retryingFetcher = async (url, options) => url.endsWith('/retry')
    ? reply({})
    : url.endsWith('/building-editor')
      ? reply({ design: state.design, editRevision: state.editRevision, activationStatus: 'active', activeDesign: state.design, cleanup: [] })
      : fetcher(url, options);
  const session = new EditorSession(retryingFetcher);
  await session.open(() => true);
  session.edit(d => { d.width = 21; });
  await session.retryWork('/retry');
  assert.equal(session.design.width, 21);
  assert.equal(session.activeDesign.width, 20);
  assert.equal(session.activationStatus, 'active');
  assert.deepEqual(session.cleanup, []);
});

test('undo and redo remain usable after saving without reverting the saved revision', async () => {
  const { fetcher } = server();
  const session = new EditorSession(fetcher);
  await session.open(() => true);
  session.edit(d => { d.width = 21; });
  await session.save();
  session.history(session.undoStack, session.redoStack);
  assert.equal(session.design.width, 20);
  assert.equal(session.design.revision, 2);
  assert.equal(session.dirty, true);
  session.history(session.redoStack, session.undoStack);
  assert.equal(session.design.width, 21);
  assert.equal(session.dirty, false);
});

test('undoing a saved deletion gives restored devices new identities', async () => {
  const { fetcher } = server();
  const session = new EditorSession(fetcher);
  await session.open(() => true);
  const old = clone(session.design.floors[0].rooms[0]);
  session.edit(d => { d.floors[0].rooms = []; });
  await session.save();
  session.history(session.undoStack, session.redoStack);
  const restored = session.design.floors[0].rooms[0];
  assert.notEqual(restored.id, old.id);
  assert.notEqual(restored.sensor.id, old.sensor.id);
  assert.equal(restored.sensor.controllerId, session.design.floors[0].controllerId);
});

test('validates room overlaps, door boundaries and same-floor connections', () => {
  const design = makeDesign();
  const floor = design.floors[0];
  assert.equal(validateDesign(design), null);
  floor.rooms[0].doors.push({ id: 'door', x: 1, z: 1 });
  assert.match(validateDesign(design), /boundary/);
  floor.rooms[0].doors[0].x = 0;
  floor.rooms[0].sensor.controllerId = null;
  assert.match(validateDesign(design), /connect/i);
  floor.rooms[0].sensor.controllerId = floor.controllerId;
  floor.rooms.push(newRoom(1, 1, 2, 2, 'Overlap', floor.controllerId));
  assert.match(validateDesign(design), /non-overlapping/);
});

test('accepts room names up to the server limit and rejects longer names', () => {
  const design = makeDesign();
  design.floors[0].rooms[0].name = 'R'.repeat(256);
  assert.equal(validateDesign(design), null);
  design.floors[0].rooms[0].name += 'R';
  assert.match(validateDesign(design), /256 characters/);
});

test('new entities receive distinct identities even when recreated at the same location', () => {
  const floor = newFloor(1);
  const a = newRoom(0, 0, 2, 2, 'Office', floor.controllerId);
  const b = newRoom(0, 0, 2, 2, 'Office', floor.controllerId);
  assert.notEqual(a.id, b.id);
  assert.notEqual(a.sensor.id, b.sensor.id);
});
