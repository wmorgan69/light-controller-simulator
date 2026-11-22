/**
 * Capture the app screenshots and walkthrough from a visible Playwright page with screencast support.
 * Both apps must be running, and outputDirectory must contain writable screenshots and videos directories.
 */
export async function captureBuildingLightingDemo(page, outputDirectory) {
  if (!page || !page.screencast || ['start', 'stop', 'showActions', 'showChapter']
    .some(method => typeof page.screencast[method] !== 'function')) {
    throw new Error('A Playwright page with screencast support is required.');
  }
  if (typeof outputDirectory !== 'string' || outputDirectory.trim().length === 0) {
    throw new Error('An existing writable output directory is required.');
  }

  const outputPath = filename => `${outputDirectory.replace(/[\\/]+$/, '')}/${filename}`;
  const simulatorUrl = 'http://127.0.0.1:5080/';
  const instrumentationUrl = 'http://127.0.0.1:5081/';
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
  const ensureRoomControls = async () => {
    const roomSelect = page.getByRole('combobox', { name: 'Room sensor' });
    if (!await roomSelect.isVisible()) {
      await page.locator('.accessible-controls summary').click();
    }
    return roomSelect;
  };
  const selectFloor2OfficeA = async () => {
    const canvas = page.locator('#buildingCanvas');
    const clickPosition = async (point, selectedFloor) => {
      const position = await canvas.evaluate(async (element, values) => {
        const THREE = await import('/vendor/three.module.js');
        const { fieldOfViewForAspect, selectedFloorCamera } = await import('/floor-view.mjs?v=floor-navigation-4');
        const aspect = element.clientWidth / element.clientHeight;
        const camera = new THREE.PerspectiveCamera(fieldOfViewForAspect(aspect), aspect, 0.1, 150);
        const preset = values.selectedFloor
          ? selectedFloorCamera(2, window.innerWidth)
          : { position: { x: 13, y: 14, z: 18 }, target: { x: 0, y: 3.3, z: 0 } };
        camera.position.set(preset.position.x, preset.position.y, preset.position.z);
        camera.lookAt(preset.target.x, preset.target.y, preset.target.z);
        camera.updateMatrixWorld();
        const projected = new THREE.Vector3(...values.point).project(camera);
        return {
          x: (projected.x + 1) * element.clientWidth / 2,
          y: (1 - projected.y) * element.clientHeight / 2
        };
      }, { point, selectedFloor });
      await canvas.click({ position });
    };

    await page.getByRole('button', { name: /^Floor 2/ }).click();
    if (await page.getByRole('button', { name: /^Floor 2/ }).getAttribute('aria-pressed') !== 'true') {
      throw new Error('Floor 2 selection failed.');
    }
    await clickPosition([1.25, 3.1, 1.67], true);
    if ((await page.locator('#roomInspectorTitle').textContent()).trim() !== 'Floor 2 — Office A') {
      throw new Error('Floor 2 Office A selection failed.');
    }
  };
  const restoreBaseline = async () => {
    await page.goto(simulatorUrl, { waitUntil: 'domcontentloaded' });
    await postAndWait(
      page.getByRole('button', { name: 'Reset building' }),
      '/api/scenarios/reset',
      'Resetting the building'
    );
    await waitForCounts({ occupied: 0, faults: 0, lights: 0 }, 'Verifying the building reset');
    const roomSelect = await ensureRoomControls();
    await roomSelect.selectOption({ label: 'controller-floor-1 — Main room' });
    await postAndWait(
      page.getByRole('button', { name: 'Trigger selected room sensor' }),
      '/api/rooms/floor-1-main/sensor/trigger',
      'Triggering the baseline room sensor'
    );
    await waitForCounts({ occupied: 1, faults: 0, lights: 4 }, 'Restoring the baseline building state');
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
    const roomSelect = await ensureRoomControls();
    await roomSelect.selectOption({ label: 'controller-floor-1 — Main room' });
    await postAndWait(
      page.getByRole('button', { name: 'Trigger selected room sensor' }),
      '/api/rooms/floor-1-main/sensor/trigger',
      'Triggering the baseline room sensor'
    );
    await waitForCounts({ occupied: 1, faults: 0, lights: 4 }, 'Preparing the initial state');

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: outputPath('screenshots/building-light-simulator.png'),
      animations: 'disabled'
    });
    await page.goto(instrumentationUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Lighting overview' }).waitFor();
    await page.getByText('4 FLOORS', { exact: true }).waitFor();
    await waitForDashboardCounts({ occupied: 1, faults: 0 }, 'Preparing the dashboard screenshot');
    await page.screenshot({
      path: outputPath('screenshots/lighting-instrumentation.png'),
      fullPage: true,
      animations: 'disabled'
    });

    await page.goto(simulatorUrl, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'All floors' }).waitFor({ state: 'visible' });
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    const even = value => Math.max(2, Math.floor(value / 2) * 2);
    const scale = Math.min(1, 1280 / viewport.width);
    await page.screencast.start({
      path: outputPath('videos/building-lighting-demo.webm'),
      size: { width: even(viewport.width * scale), height: even(viewport.height * scale) }
    });
    recordingStarted = true;
    try {
      await page.screencast.showActions();
      await page.screencast.showChapter('All-floors view');
      await page.getByRole('button', { name: 'All floors' }).click();
      await page.waitForTimeout(1500);

      const canvas = page.locator('#buildingCanvas');
      await canvas.scrollIntoViewIfNeeded();
      const box = await canvas.boundingBox();
      if (!box) {
        throw new Error('The building canvas is not visible.');
      }
      const centerX = box.x + box.width * 0.5;
      const centerY = box.y + box.height * 0.52;

      await page.screencast.showChapter('Pan and rotate the building');
      await page.waitForTimeout(1000);
      await page.mouse.move(centerX, centerY);
      await page.mouse.down({ button: 'left' });
      await page.mouse.move(centerX + 90, centerY + 35, { steps: 10 });
      await page.mouse.up({ button: 'left' });
      await page.waitForTimeout(1000);
      await page.mouse.move(centerX, centerY);
      await page.mouse.down({ button: 'right' });
      await page.mouse.move(centerX + 55, centerY + 25, { steps: 8 });
      await page.mouse.up({ button: 'right' });
      await page.waitForTimeout(1000);

      await page.screencast.showChapter('Select a floor and zoom in and out');
      await page.waitForTimeout(1000);
      await page.getByRole('button', { name: /^Floor 2/ }).click();
      if (await page.getByRole('button', { name: /^Floor 2/ }).getAttribute('aria-pressed') !== 'true') {
        throw new Error('Floor 2 selection failed.');
      }
      await page.waitForTimeout(1000);
      await canvas.scrollIntoViewIfNeeded();
      const floorBox = await canvas.boundingBox();
      if (!floorBox) {
        throw new Error('The building canvas is not visible.');
      }
      await page.mouse.move(floorBox.x + floorBox.width * 0.5, floorBox.y + floorBox.height * 0.52);
      await page.mouse.wheel(0, -400);
      await page.waitForTimeout(1000);
      await page.mouse.wheel(0, 400);
      await page.waitForTimeout(1000);

      await page.screencast.showChapter('Select a room');
      await selectFloor2OfficeA();
      await page.waitForTimeout(1000);

      await page.screencast.showChapter('Presence updates instrumentation');
      await page.waitForTimeout(1600);
      await page.getByRole('switch', { name: 'Presence' }).check();
      await waitForCounts({ occupied: 2, faults: 0, lights: 5 }, 'Activating presence');
      await page.goto(instrumentationUrl, { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: 'Lighting overview' }).waitFor();
      await waitForDashboardCounts({ occupied: 2, faults: 0, lights: 5 }, 'Showing the presence update');
      await page.waitForTimeout(1600);

      await page.screencast.showChapter('Sensor fault updates instrumentation');
      await page.waitForTimeout(1600);
      await page.goto(simulatorUrl, { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: 'All floors' }).waitFor({ state: 'visible' });
      await selectFloor2OfficeA();
      await page.getByRole('switch', { name: 'Sensor fault' }).check();
      await waitForCounts({ occupied: 1, faults: 1 }, 'Activating the sensor fault');
      await page.goto(instrumentationUrl, { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: 'Lighting overview' }).waitFor();
      await waitForDashboardCounts({ occupied: 1, faults: 1, lights: 5 }, 'Showing the fault update');
      await page.waitForTimeout(5000);

      await page.goto(simulatorUrl, { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: 'Occupancy demo' }).waitFor({ state: 'visible' });
      await page.screencast.showChapter('Run the occupancy demo');
      await page.waitForTimeout(1600);
      await page.getByRole('button', { name: 'Occupancy demo' }).click();
      const occupancyCounts = await waitForState(
        counts => counts.occupied >= 4 && counts.occupied <= 8 && counts.faults === 0,
        '4 to 8 occupied rooms and no faults',
        'Running the occupancy demo'
      );
      await page.goto(instrumentationUrl, { waitUntil: 'domcontentloaded' });
      await page.getByRole('heading', { name: 'Lighting overview' }).waitFor();
      await waitForDashboardCounts(
        { occupied: occupancyCounts.occupied, faults: 0 },
        'Showing the occupancy demo'
      );
      await page.waitForTimeout(2800);
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
