import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { activateRoomControl, captureBuildingLightingDemo, recordingCamera, rotateFullTurn, selectBaselineRoom, selectFloor2OfficeA, showDashboardUpdate, showFloorLayouts, showOccupancyScenario, showSiteAddress } from '../docs/assets/record-demo.mjs';
import { fieldOfViewForAspect, selectedFloorCamera } from '../src/Devices.BuildingControl.Web/frontend/scene/floor-view.ts';

test('recording camera uses the simulator floor preset at desktop and mobile widths', async () => {
  for (const width of [320, 1280]) {
    const camera = await recordingCamera(width, 600, 800);
    assert.equal(camera.fieldOfView, fieldOfViewForAspect(600 / 800));
    assert.deepEqual(camera.preset, selectedFloorCamera(2, width));
  }
});

test('recording selects the office using the current simulator canvas and room controls', async () => {
  const steps = [];
  const canvas = {
    evaluate: async () => ({ viewportWidth: 1280, canvasWidth: 800, canvasHeight: 600 }),
    click: async options => steps.push(['canvas', options.position])
  };
  const page = {
    locator: selector => { assert.equal(selector, 'canvas.simulator-canvas'); return canvas; },
    getByRole: (role, options) => {
      if (role === 'button') return {
        click: async () => steps.push(['floor']),
        getAttribute: async () => 'true'
      };
      assert.equal(role, 'region');
      assert.equal(options.name, 'Room controls');
      return { getByRole: (headingRole, headingOptions) => {
        assert.equal(headingRole, 'heading');
        assert.deepEqual(headingOptions, { name: 'Floor 2 — Meeting Office', exact: true });
        return { waitFor: async () => steps.push(['verified']) };
      } };
    }
  };
  await selectFloor2OfficeA(page);
  assert.equal(steps[0][0], 'floor');
  assert.equal(steps[1][0], 'canvas');
  assert.ok(steps[1][1].x > 400 && steps[1][1].x < 800);
  assert.ok(steps[1][1].y > 0 && steps[1][1].y < 600);
  assert.deepEqual(steps[2], ['verified']);
});

test('baseline room selection opens the MUI menu and chooses the stable room ID', async () => {
  for (const visible of [true, false]) {
    const steps = [];
    const page = {
      locator: selector => {
        assert.equal(selector, '.accessible-controls summary');
        return { click: async () => steps.push('expand') };
      },
      getByRole: (role, options) => {
        if (role === 'combobox') {
          assert.equal(options.name, 'Room sensor');
          return { isVisible: async () => visible, click: async () => steps.push('open') };
        }
        assert.equal(role, 'listbox');
        return { locator: selector => {
          assert.equal(selector, '[data-value="floor-1-main"]');
          return { click: async () => steps.push('select') };
        } };
      }
    };
    await selectBaselineRoom(page);
    assert.deepEqual(steps, visible ? ['open', 'select'] : ['expand', 'open', 'select']);
  }
});

test('room controls use labeled checkboxes and verify the resulting state', async () => {
  for (const name of ['Presence', 'Sensor fault']) {
    const steps = [];
    let checked = true;
    const checkedLocator = {};
    const page = { waitForTimeout: async duration => steps.push(['hold', duration]), locator: selector => {
      assert.equal(selector, ':checked');
      return checkedLocator;
    }, getByRole: (role, options) => {
      assert.equal(role, 'region');
      assert.equal(options.name, 'Room controls');
      return { getByRole: (controlRole, controlOptions) => {
        assert.equal(controlRole, 'checkbox');
        assert.deepEqual(controlOptions, { name, exact: true });
        return {
          scrollIntoViewIfNeeded: async () => steps.push('visible'),
          hover: async () => steps.push('hover'),
          click: async () => steps.push('click'),
          and: locator => {
            assert.equal(locator, checkedLocator);
            return { waitFor: async options => {
              assert.deepEqual(options, { state: 'attached' });
              if (!checked) throw new Error('checkbox not checked');
              steps.push('checked');
            } };
          }
        };
      } };
    } };
    const expected = { occupied: 1 };
    const verify = async (counts, label) => {
      assert.equal(counts, expected);
      assert.equal(label, 'activation');
      steps.push('verify');
    };
    await activateRoomControl(page, name, verify, expected, 'activation');
    assert.deepEqual(steps, ['visible', 'hover', ['hold', 1500], 'click', 'verify', 'checked', ['hold', 3000]]);
    checked = false;
    await assert.rejects(activateRoomControl(page, name, verify, expected, 'activation'),
      /checkbox not checked/);
  }
});

test('shows every floor layout and returns to Floor 3', async () => {
  const steps = [];
  const page = {
    getByRole: (role, { name }) => ({
      click: async () => steps.push(Number(name.source.match(/\d+/)[0])),
      getAttribute: async () => 'true'
    }),
    waitForTimeout: async duration => steps.push(duration)
  };
  await showFloorLayouts(page);
  assert.deepEqual(steps, [1, 2000, 2, 2000, 3, 2000, 4, 2000, 3, 2000]);
});

test('reports a floor selection failure during the walkthrough', async () => {
  const page = {
    getByRole: () => ({ click: async () => {}, getAttribute: async () => 'false' }),
    waitForTimeout: async () => {}
  };
  await assert.rejects(showFloorLayouts(page), /Floor 1 selection failed/);
});

test('holds the verified dashboard update for five seconds', async () => {
  const steps = [];
  const expected = { occupied: 2, faults: 0, lights: 7 };
  await showDashboardUpdate(
    { waitForTimeout: async duration => steps.push(['hold', duration]) },
    async (counts, label) => steps.push(['verify', counts, label]),
    expected,
    'presence'
  );
  assert.deepEqual(steps, [['verify', expected, 'presence'], ['hold', 5000]]);
});

test('shows the occupancy scenario and holds the resulting lights before the dashboard', async () => {
  const steps = [];
  const button = {
    scrollIntoViewIfNeeded: async () => steps.push('visible'),
    hover: async () => steps.push('hover')
  };
  const counts = { occupied: 5, faults: 0 };
  const page = {
    getByRole: (role, { name }) => name === 'All floors'
      ? { click: async () => steps.push('all floors') }
      : button,
    screencast: { showChapter: async title => steps.push(title) },
    waitForTimeout: async duration => steps.push(duration)
  };
  const result = await showOccupancyScenario(
    page,
    async (target, path) => {
      assert.equal(target, button);
      steps.push(path);
    },
    async matches => {
      assert.ok(matches(counts));
      assert.ok(!matches({ occupied: 3, faults: 0 }));
      assert.ok(!matches({ occupied: 5, faults: 1 }));
      steps.push('verified');
      return counts;
    }
  );
  assert.equal(result, counts);
  assert.deepEqual(steps, ['all floors', 'Occupancy demo', 'visible', 'hover', 1500,
    '/api/scenarios/occupancy', 'verified', 6000]);
});

test('rejects incomplete screencast support before changing simulator state', async () => {
  const methods = ['start', 'stop', 'showChapter'];
  for (const missing of methods) {
    const screencast = Object.fromEntries(methods.map(method => [method, () => {}]));
    delete screencast[missing];
    let visited = false;
    const page = { screencast, evaluate: () => { visited = true; } };
    await assert.rejects(captureBuildingLightingDemo(page, 'output'), /screencast support/);
    assert.equal(visited, false);
  }
});

test('a full rotation drags horizontally by the canvas height', async () => {
  const moves = [];
  let time = 0;
  let dragStart;
  let dragEnd;
  let pressed = false;
  const page = {
    mouse: {
      move: async (x, y) => { moves.push({ x, y, pressed }); time += 80; },
      down: async () => { pressed = true; dragStart = time; },
      up: async () => { dragEnd = time; pressed = false; }
    },
    waitForTimeout: async duration => { time += duration; }
  };
  await rotateFullTurn(page, { x: 100, y: 50, width: 900, height: 560 }, { now: () => time });
  assert.equal(moves.at(-1).x - moves[0].x, 560);
  assert.ok(moves.slice(1).every(move => move.y === moves[0].y && move.pressed));
  assert.ok(moves.length >= 20 && dragEnd - dragStart >= 4000 && dragEnd - dragStart <= 4200,
    'rotation should remain smooth and take about four seconds even when mouse movement is slow');
  assert.equal(pressed, false);
});

test('recording address strip shows the current URL without duplicating it', async () => {
  const dom = new JSDOM('<!doctype html><body></body>', {
    url: 'http://localhost:5080/', runScripts: 'outside-only'
  });
  const page = { evaluate: async action => dom.window.eval(`(${action})()`) };
  await showSiteAddress(page);
  dom.reconfigure({ url: 'http://localhost:5081/' });
  await showSiteAddress(page);
  assert.equal(dom.window.document.querySelectorAll('#recording-site-address').length, 1);
  assert.equal(dom.window.document.querySelector('[aria-label="Site address"]').textContent, 'http://localhost:5081/');
  dom.window.close();
});

test('a full rotation rejects a canvas too narrow for the drag', async () => {
  await assert.rejects(rotateFullTurn({}, { x: 0, y: 0, width: 300, height: 560 }), /too narrow/);
});

test('captures the overview and waits for current dashboard light counts', async () => {
  let occupied = false;
  let selectedFloor = 'Floor 3';
  let lightReads = 0;
  const screenshotViews = [];
  const page = {
    screencast: Object.fromEntries(
      ['start', 'stop', 'showActions', 'showChapter'].map(method => [method, async () => {}])
    ),
    evaluate: async fn => {
      const source = fn.toString();
      if (source.includes('visibilityState')) return 'visible';
      if (source.includes('/api/controllers')) {
        return [{ faults: [], rooms: [{ presence: occupied, lightStrips: Array(6).fill({ isOn: occupied }) }] }];
      }
    },
    goto: async () => {},
    waitForResponse: async () => ({ ok: () => true }),
    waitForTimeout: async () => {},
    getByRole: (role, { name } = {}) => role === 'listbox' ? {
      locator: selector => {
        assert.equal(selector, '[data-value="floor-1-main"]');
        return { click: async () => {} };
      }
    } : ({
      click: async () => {
        if (name === 'Reset building') occupied = false;
        if (name === 'Trigger selected room sensor') occupied = true;
        if (name === 'All floors') selectedFloor = name;
      },
      isVisible: async () => true,
      waitFor: async () => {}
    }),
    getByText: () => ({ waitFor: async () => {} }),
    locator: () => ({
      filter: ({ hasText }) => ({
        locator: () => ({
          textContent: async () => {
            if (hasText === 'Occupied rooms') return '1';
            if (hasText === 'Active faults') return '0';
            lightReads++;
            return lightReads === 1 ? '0' : '6';
          }
        })
      })
    }),
    screenshot: async ({ path }) => {
      screenshotViews.push({ path, selectedFloor, lightReads });
      if (path.endsWith('lighting-instrumentation.png')) throw new Error('stop after screenshots');
    }
  };
  await assert.rejects(captureBuildingLightingDemo(page, 'output'), /stop after screenshots/);
  assert.equal(screenshotViews[0].selectedFloor, 'All floors');
  assert.match(screenshotViews[0].path, /(?:^|[\\/])building-control\.png$/);
  assert.ok(screenshotViews[1].lightReads >= 2);
});

test('restores the baseline if initial reset fails', async () => {
  const requests = [];
  let stateReads = 0;
  const page = {
    screencast: Object.fromEntries(
      ['start', 'stop', 'showActions', 'showChapter'].map(method => [method, async () => {}])
    ),
    evaluate: async () => {
      stateReads++;
      if (stateReads === 1) return 'visible';
      if (stateReads === 2) return [];
      return [{ faults: [], rooms: [{ presence: true, lightStrips: Array(6).fill({ isOn: true }) }] }];
    },
    goto: async () => {},
    waitForResponse: async () => {
      const failed = requests.length === 0;
      requests.push(failed ? 500 : 200);
      return { ok: () => !failed, status: () => failed ? 500 : 200 };
    },
    getByRole: role => role === 'listbox' ? {
      locator: selector => {
        assert.equal(selector, '[data-value="floor-1-main"]');
        return { click: async () => {} };
      }
    } : ({
      click: async () => {},
      isVisible: async () => true
    })
  };
  await assert.rejects(captureBuildingLightingDemo(page, 'output'), /Resetting the building failed: HTTP 500/);
  assert.deepEqual(requests, [500, 200, 200]);
});
