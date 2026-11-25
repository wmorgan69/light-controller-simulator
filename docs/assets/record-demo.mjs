export async function rotateFullTurn(page, box, clock = globalThis.performance ?? Date) {
  const distance = box.height;
  if (distance + 20 > box.width) {
    throw new Error('The building canvas is too narrow for a full rotation.');
  }
  const x = box.x + 10;
  const y = box.y + box.height * 0.52;
  await page.mouse.move(x, y);
  await page.mouse.down({ button: 'left' });
  const start = clock.now();
  let progress = 0;
  while (progress < 1) {
    progress = Math.min((clock.now() - start) / 4000, 1);
    await page.mouse.move(x + distance * progress, y);
    const remaining = 4000 - (clock.now() - start);
    if (progress < 1 && remaining > 0) await page.waitForTimeout(Math.min(100, remaining));
  }
  await page.mouse.up({ button: 'left' });
  await page.waitForTimeout(100);
}

export async function showSiteAddress(page) {
  await page.evaluate(() => {
    let frame = document.getElementById('recording-site-address');
    if (!frame) {
      frame = document.createElement('div');
      frame.id = 'recording-site-address';
      frame.style.cssText = 'position:sticky;top:0;z-index:10000;box-sizing:border-box;'
        + 'height:46px;padding:7px 14px;background:#d6deea;display:flex;'
        + 'align-items:center;gap:12px;font:14px system-ui,sans-serif;';
      const label = document.createElement('span');
      label.textContent = 'Demo';
      label.style.cssText = 'color:#40516a;font-weight:700;';
      const address = document.createElement('div');
      address.setAttribute('aria-label', 'Site address');
      address.style.cssText = 'flex:1;min-width:0;padding:6px 12px;border-radius:6px;'
        + 'background:#fff;color:#17243a;overflow:hidden;white-space:nowrap;';
      frame.append(label, address);
      document.body.prepend(frame);
    }
    frame.querySelector('[aria-label="Site address"]').textContent = window.location.href;
  });
}

export async function showFloorLayouts(page) {
  for (const floor of [1, 2, 3, 4, 3]) {
    const button = page.getByRole('button', { name: new RegExp(`^Floor ${floor}`) });
    await button.click();
    if (await button.getAttribute('aria-pressed') !== 'true') {
      throw new Error(`Floor ${floor} selection failed.`);
    }
    await page.waitForTimeout(2000);
  }
}

export async function showDashboardUpdate(page, waitForDashboardCounts, expected, label) {
  await waitForDashboardCounts(expected, label);
  await page.waitForTimeout(5000);
}

export async function showOccupancyScenario(page, postAndWait, waitForState) {
  await page.getByRole('button', { name: 'All floors' }).click();
  await page.screencast.showChapter('Occupancy demo');
  const button = page.getByRole('button', { name: 'Occupancy demo' });
  await button.scrollIntoViewIfNeeded();
  await button.hover();
  await page.waitForTimeout(1500);
  await postAndWait(
    button,
    '/api/scenarios/occupancy',
    'Running the occupancy demo'
  );
  const counts = await waitForState(
    actual => actual.occupied >= 4 && actual.occupied <= 7 && actual.faults === 0,
    '4 to 7 occupied rooms and no faults',
    'Running the occupancy demo'
  );
  await page.waitForTimeout(6000);
  return counts;
}

export async function recordingCamera(viewportWidth, canvasWidth, canvasHeight) {
  const { tsImport } = await import('tsx/esm/api');
  const { fieldOfViewForAspect, selectedFloorCamera } =
    await tsImport('../../src/Devices.BuildingControl.Web/frontend/scene/floor-view.ts', import.meta.url);
  return {
    fieldOfView: fieldOfViewForAspect(canvasWidth / canvasHeight),
    preset: selectedFloorCamera(2, viewportWidth)
  };
}

export async function selectBaselineRoom(page) {
  const roomSelect = page.getByRole('combobox', { name: 'Room sensor' });
  if (!await roomSelect.isVisible()) {
    await page.locator('.accessible-controls summary').click();
  }
  await roomSelect.click();
  await page.getByRole('listbox').locator('[data-value="floor-1-main"]').click();
}

export async function activateRoomControl(page, name, waitForCounts, expected, label) {
  const checkbox = page.getByRole('region', { name: 'Room controls' })
    .getByRole('checkbox', { name, exact: true });
  await checkbox.scrollIntoViewIfNeeded();
  await checkbox.hover();
  await page.waitForTimeout(1500);
  await checkbox.click();
  await waitForCounts(expected, label);
  await checkbox.and(page.locator(':checked')).waitFor({ state: 'attached' });
  await page.waitForTimeout(3000);
}

export async function selectFloor2OfficeA(page) {
  const floor = page.getByRole('button', { name: /^Floor 2/ });
  await floor.click();
  if (await floor.getAttribute('aria-pressed') !== 'true') {
    throw new Error('Floor 2 selection failed.');
  }
  const canvas = page.locator('canvas.simulator-canvas');
  const { viewportWidth, canvasWidth, canvasHeight } = await canvas.evaluate(element => ({
    viewportWidth: window.innerWidth, canvasWidth: element.clientWidth, canvasHeight: element.clientHeight
  }));
  const cameraSettings = await recordingCamera(viewportWidth, canvasWidth, canvasHeight);
  const THREE = await import('three');
  const camera = new THREE.PerspectiveCamera(cameraSettings.fieldOfView, canvasWidth / canvasHeight, 0.1, 1000);
  const { position: cameraPosition, target } = cameraSettings.preset;
  camera.position.set(cameraPosition.x, cameraPosition.y, cameraPosition.z);
  camera.lookAt(target.x, target.y, target.z);
  camera.updateMatrixWorld();
  const projected = new THREE.Vector3(3.8, 3.1, 1.47).project(camera);
  const position = {
    x: (projected.x + 1) * canvasWidth / 2,
    y: (1 - projected.y) * canvasHeight / 2
  };
  await canvas.click({ position });
  await page.getByRole('region', { name: 'Room controls' })
    .getByRole('heading', { name: 'Floor 2 — Meeting Office', exact: true }).waitFor();
}

/**
 * Capture the app screenshots and walkthrough from a visible Playwright page with screencast support.
 * Both apps must be running, and outputDirectory must contain writable screenshots and videos directories.
 */
export async function captureBuildingLightingDemo(page, outputDirectory, {
  simulatorUrl = 'http://127.0.0.1:5080/',
  instrumentationUrl = 'http://127.0.0.1:5081/'
} = {}) {
  if (!page || !page.screencast || ['start', 'stop', 'showChapter']
    .some(method => typeof page.screencast[method] !== 'function')) {
    throw new Error('A Playwright page with screencast support is required.');
  }
  if (typeof outputDirectory !== 'string' || outputDirectory.trim().length === 0) {
    throw new Error('An existing writable output directory is required.');
  }

  const outputPath = filename => `${outputDirectory.replace(/[\\/]+$/, '')}/${filename}`;
  const getControllers = async (timeoutMs = 10000) => page.evaluate(async timeout => {
    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), timeout);
    try {
      const response = await fetch('/api/controllers', {
        cache: 'no-store',
        signal: abortController.signal
      });
      if (!response.ok) {
        throw new Error(`Could not read simulator state: HTTP ${response.status}.`);
      }
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }, timeoutMs);
  const getCounts = controllers => ({
    occupied: controllers.flatMap(controller => controller.rooms).filter(room => room.presence).length,
    faults: controllers.reduce((count, controller) => count + controller.faults.length, 0),
    lights: controllers.flatMap(controller => controller.rooms)
      .flatMap(room => room.lightStrips)
      .filter(strip => strip.isOn && !strip.isFaulted).length
  });
  const waitForState = async (matches, expected, label) => {
    const deadline = Date.now() + 10000;
    let actual;
    do {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        break;
      }
      actual = getCounts(await getControllers(remaining));
      if (matches(actual)) {
        return actual;
      }
      await page.waitForTimeout(Math.min(250, Math.max(0, deadline - Date.now())));
    } while (Date.now() < deadline);
    throw new Error(`${label}: expected ${expected}, got ${JSON.stringify(actual)}.`);
  };
  const waitForCounts = (expected, label) => waitForState(
    actual => Object.entries(expected).every(([key, value]) => actual[key] === value),
    JSON.stringify(expected),
    label
  );
  const postAndWait = async (button, path, label) => {
    const responsePromise = page.waitForResponse(
      response => response.request().method() === 'POST'
        && response.url().replace(/^https?:\/\/[^/]+/, '').split(/[?#]/, 1)[0] === path,
      { timeout: 10000 }
    );
    const [, response] = await Promise.all([button.click(), responsePromise]);
    if (!response.ok()) {
      throw new Error(`${label} failed: HTTP ${response.status()}.`);
    }
  };
  const dashboardCounts = async deadline => {
    const metric = async label => {
      const timeout = Math.max(1, deadline - Date.now());
      return (await page.locator('.summary-card')
        .filter({ hasText: label })
        .locator('.summary-value')
        .textContent({ timeout })).trim();
    };
    return {
      occupied: Number(await metric('Occupied rooms')),
      faults: Number(await metric('Active faults')),
      lights: Number(await metric('Lights on'))
    };
  };
  const waitForDashboardCounts = async (expected, label) => {
    const deadline = Date.now() + 10000;
    let actual;
    do {
      actual = await dashboardCounts(deadline);
      if (Object.entries(expected).every(([key, value]) => actual[key] === value)) {
        return actual;
      }
      await page.waitForTimeout(Math.min(250, Math.max(0, deadline - Date.now())));
    } while (Date.now() < deadline);
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`);
  };
  const restoreBaseline = async () => {
    await page.goto(simulatorUrl, { waitUntil: 'domcontentloaded' });
    await postAndWait(
      page.getByRole('button', { name: 'Reset building' }),
      '/api/scenarios/reset',
      'Resetting the building'
    );
    await waitForCounts({ occupied: 0, faults: 0, lights: 0 }, 'Verifying the building reset');
    await selectBaselineRoom(page);
    await postAndWait(
      page.getByRole('button', { name: 'Trigger selected room sensor' }),
      '/api/rooms/floor-1-main/sensor/trigger',
      'Triggering the baseline room sensor'
    );
    await waitForCounts({ occupied: 1, faults: 0, lights: 6 }, 'Restoring the baseline building state');
  };

  let stateMayHaveChanged = false;
  let recordingStarted = false;
  try {
    if (await page.evaluate(() => document.visibilityState) !== 'visible') {
      throw new Error('The browser page is not visible.');
    }

    await page.goto(simulatorUrl, { waitUntil: 'domcontentloaded' });
    stateMayHaveChanged = true;
    await postAndWait(
      page.getByRole('button', { name: 'Reset building' }),
      '/api/scenarios/reset',
      'Resetting the building'
    );
    await waitForCounts({ occupied: 0, faults: 0, lights: 0 }, 'Verifying the building reset');
    await selectBaselineRoom(page);
    await postAndWait(
      page.getByRole('button', { name: 'Trigger selected room sensor' }),
      '/api/rooms/floor-1-main/sensor/trigger',
      'Triggering the baseline room sensor'
    );
    await waitForCounts({ occupied: 1, faults: 0, lights: 6 }, 'Preparing the initial state');

    await page.getByRole('button', { name: 'All floors' }).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: outputPath('screenshots/building-control.png'),
      animations: 'disabled'
    });
    await page.goto(instrumentationUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Lighting overview' }).waitFor();
    await page.getByText('4 FLOORS', { exact: true }).waitFor();
    await waitForDashboardCounts({ occupied: 1, faults: 0, lights: 6 }, 'Preparing the dashboard screenshot');
    await page.screenshot({
      path: outputPath('screenshots/lighting-instrumentation.png'),
      fullPage: true,
      animations: 'disabled'
    });

    await page.goto(simulatorUrl, { waitUntil: 'domcontentloaded' });
    await showSiteAddress(page);
    await page.getByRole('button', { name: 'All floors' }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'All floors' }).click();
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    const even = value => Math.max(2, Math.floor(value / 2) * 2);
    const scale = Math.min(1, 1280 / viewport.width);
    await page.screencast.start({
      path: outputPath('videos/building-lighting-demo.webm'),
      size: { width: even(viewport.width * scale), height: even(viewport.height * scale) }
    });
    recordingStarted = true;
    try {
      const canvas = page.locator('canvas.simulator-canvas');
      await canvas.scrollIntoViewIfNeeded();
      const box = await canvas.boundingBox();
      if (!box) {
        throw new Error('The building canvas is not visible.');
      }
      const centerX = box.x + box.width * 0.5;
      const centerY = box.y + box.height * 0.52;

      await rotateFullTurn(page, box);
      await page.mouse.move(centerX, centerY);
      await page.mouse.down({ button: 'right' });
      await page.mouse.move(centerX + 55, centerY + 25, { steps: 8 });
      await page.mouse.up({ button: 'right' });
      await page.waitForTimeout(100);
      await page.mouse.wheel(0, -400);
      await page.waitForTimeout(100);
      await page.mouse.wheel(0, 400);
      await page.waitForTimeout(100);

      await showFloorLayouts(page);
      await page.waitForTimeout(200);
      await canvas.scrollIntoViewIfNeeded();
      const floorBox = await canvas.boundingBox();
      if (!floorBox) {
        throw new Error('The building canvas is not visible.');
      }
      await page.mouse.move(floorBox.x + floorBox.width * 0.5, floorBox.y + floorBox.height * 0.52);
      await page.mouse.wheel(0, -400);
      await page.waitForTimeout(100);
      await page.mouse.wheel(0, 400);
      await page.waitForTimeout(100);
      const floorX = floorBox.x + floorBox.width * 0.5;
      const floorY = floorBox.y + floorBox.height * 0.52;
      await rotateFullTurn(page, floorBox);
      await page.mouse.move(floorX, floorY);
      await page.mouse.down({ button: 'right' });
      await page.mouse.move(floorX + 45, floorY + 20, { steps: 8 });
      await page.mouse.up({ button: 'right' });
      await page.waitForTimeout(200);

      await selectFloor2OfficeA(page);
      await page.locator('.room-inspector').scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);

      await page.screencast.showChapter('Presence updates instrumentation');
      await activateRoomControl(page, 'Presence', waitForCounts,
        { occupied: 2, faults: 0, lights: 7 }, 'Activating presence');
      await page.goto(instrumentationUrl, { waitUntil: 'domcontentloaded' });
      await showSiteAddress(page);
      await page.getByRole('heading', { name: 'Lighting overview' }).waitFor();
      await showDashboardUpdate(page, waitForDashboardCounts,
        { occupied: 2, faults: 0, lights: 7 }, 'Showing the presence update');

      await page.goto(simulatorUrl, { waitUntil: 'domcontentloaded' });
      await showSiteAddress(page);
      await page.getByRole('button', { name: 'All floors' }).waitFor({ state: 'visible' });
      await selectFloor2OfficeA(page);
      await page.locator('.room-inspector').scrollIntoViewIfNeeded();
      await page.screencast.showChapter('Sensor fault updates instrumentation');
      await activateRoomControl(page, 'Sensor fault', waitForCounts,
        { occupied: 1, faults: 1 }, 'Activating the sensor fault');
      await page.goto(instrumentationUrl, { waitUntil: 'domcontentloaded' });
      await showSiteAddress(page);
      await page.getByRole('heading', { name: 'Lighting overview' }).waitFor();
      await showDashboardUpdate(page, waitForDashboardCounts,
        { occupied: 1, faults: 1, lights: 7 }, 'Showing the fault update');

      await page.goto(simulatorUrl, { waitUntil: 'domcontentloaded' });
      await showSiteAddress(page);
      await page.getByRole('button', { name: 'Occupancy demo' }).waitFor({ state: 'visible' });
      const occupancyCounts = await showOccupancyScenario(page, postAndWait, waitForState);
      await page.goto(instrumentationUrl, { waitUntil: 'domcontentloaded' });
      await showSiteAddress(page);
      await page.getByRole('heading', { name: 'Lighting overview' }).waitFor();
      await showDashboardUpdate(page, waitForDashboardCounts,
        { occupied: occupancyCounts.occupied, faults: 0 },
        'Showing the occupancy demo'
      );
    } finally {
      if (recordingStarted) {
        await page.screencast.stop();
      }
    }
  } finally {
    if (stateMayHaveChanged) {
      await restoreBaseline();
    }
  }
}
