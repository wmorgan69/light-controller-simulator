const messages = Object.freeze({
  pageTitle: 'Building Light Simulator',
  pageSubtitle: 'Four-floor controller simulation',
  floorSelectionHint: 'Choose a floor; select it again to reset the camera.',
  checkingMqtt: 'Checking MQTT...',
  buildingFloors: 'Building floors',
  building: 'Building',
  allFloors: 'All floors',
  loadingFloors: 'Loading floors...',
  scenarios: 'Scenarios',
  resetBuilding: 'Reset building',
  occupancyDemo: 'Occupancy demo',
  occupancyDemoTitle: 'Randomly occupy up to 2 rooms on each floor',
  simulatorView: '3D building view',
  simulatorCanvas: 'Interactive 3D view of the four-floor building. Illustrative open doors and a rear walkway connect rooms to the stairs between floors. A selected floor shows sections of the stairs above and below where available. Use the accessible controls below to select rooms and trigger sensors or faults.',
  stairsHelp: 'Stairs are at the back; orbit to view them.',
  wiringLabel: 'Wiring:',
  sensorWiringLegend: 'blue = sensors',
  lightWiringLegend: 'yellow = lights',
  roomControls: 'Room controls',
  closeRoomControls: 'Close room controls',
  closeSymbol: '×',
  presence: 'Presence',
  sensorFault: 'Sensor fault',
  liveStatus: 'Live status',
  accessibleControls: 'Accessible controls',
  floorView: 'Floor view',
  floor: 'Floor',
  status: 'Status',
  roomSensor: 'Room sensor',
  triggerSelectedRoomSensor: 'Trigger selected room sensor',
  faultType: 'Fault type',
  sensor: 'Sensor',
  lightStrip: 'Light strip',
  controller: 'Controller',
  accessibleFaultTarget: 'Accessible fault target',
  injectSelectedFault: 'Inject selected fault',
  allActiveFaults: 'All active faults',
  dismiss: 'Dismiss',
  floorName: 'Floor {floor}',
  floorSceneLabel: 'FLOOR {floor}',
  occupiedRooms: '{occupied}/{total} rooms occupied',
  floorRoomName: 'Floor {floor} — {room}',
  floorNameOption: 'Floor {floor}',
  clear: 'Clear',
  noActiveFaults: 'No active faults',
  statusTableHeader: 'Rooms / lights',
  roomLightsOn: '{room}: {on}/{total} on',
  roomTarget: '{controller} — {room}',
  sensorTarget: 'Floor {floor} — {room} sensor',
  lightTarget: 'Floor {floor} — {room}, strip {strip}',
  controllerTarget: 'Floor {floor} controller',
  simulatedSensorFault: 'Simulated sensor fault',
  simulatedScopedFault: 'Simulated {scope} fault',
  healthyStatus: 'Healthy',
  faultedStatus: 'Faulted',
  offlineStatus: 'Offline',
  touchGestureHelp: 'Tap a room to select · drag to orbit · two-finger pan and zoom',
  mouseGestureHelp: 'Click a room to select · drag to orbit · right-drag to pan · scroll to zoom',
  selectedFloorUnavailable: 'The selected floor is unavailable.',
  requestFailed: 'Request failed ({status}): {body}',
  controllerApiFailed: 'Controller API returned {status}',
  statusChangedDuringRefresh: 'Status changed during refresh; reload the page.',
  mqttConnected: 'MQTT connected',
  mqttUnavailableHttpActive: 'MQTT unavailable · HTTP active',
  transportStatusUnavailable: 'Transport status unavailable',
  actionStatusRefreshFailed: 'Action applied, but status refresh failed: {error}',
  scenarioStatusRefreshFailed: 'Scenario applied, but status refresh failed: {error}',
  floorListUnavailable: 'Floor list unavailable.',
  unableToLoadBuildingState: 'Unable to load building state: {error}',
  roomCount: Object.freeze({
    one: '{count} room',
    other: '{count} rooms'
  })
});

const englishPluralRules = new Intl.PluralRules('en');
const interpolationToken = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;
const controllerStatusKeys = Object.freeze({
  Healthy: 'healthyStatus',
  Faulted: 'faultedStatus',
  Offline: 'offlineStatus'
});

function getMessage(key) {
  if (typeof key !== 'string' || !Object.hasOwn(messages, key)) {
    throw new RangeError(`Missing English localization key: ${String(key)}`);
  }
  return messages[key];
}

function interpolate(template, values) {
  return template.replace(interpolationToken, (token, name) => {
    if (!Object.hasOwn(values, name)) {
      throw new RangeError(`Missing interpolation value "${name}" for English localization.`);
    }
    return String(values[name]);
  });
}

export function t(key, values = {}) {
  const message = getMessage(key);
  if (typeof message !== 'string') {
    throw new TypeError(`English localization key "${key}" requires plural().`);
  }
  if (values === null || typeof values !== 'object') {
    throw new TypeError('English localization values must be an object.');
  }
  return interpolate(message, values);
}

export function plural(key, count, values = {}) {
  const forms = getMessage(key);
  if (!forms || typeof forms !== 'object' || typeof forms.other !== 'string') {
    throw new TypeError(`English localization key "${key}" does not define plural forms.`);
  }
  if (typeof count !== 'number' || !Number.isFinite(count)) {
    throw new TypeError('English plural count must be a finite number.');
  }
  if (values === null || typeof values !== 'object') {
    throw new TypeError('English localization values must be an object.');
  }
  const message = forms[englishPluralRules.select(count)] ?? forms.other;
  return interpolate(message, { ...values, count });
}

export function controllerStatusLabel(status) {
  return Object.hasOwn(controllerStatusKeys, status)
    ? t(controllerStatusKeys[status])
    : status;
}

export function localizeMarkup(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(element => {
    element.textContent = t(element.dataset.i18n);
  });
  root.querySelectorAll('[data-i18n-aria-label]').forEach(element => {
    element.setAttribute('aria-label', t(element.dataset.i18nAriaLabel));
  });
  root.querySelectorAll('[data-i18n-title]').forEach(element => {
    element.setAttribute('title', t(element.dataset.i18nTitle));
  });
}
