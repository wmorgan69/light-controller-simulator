const messages = Object.freeze({
  pageTitle: 'Building Light Simulator',
  pageSubtitle: 'Building controller simulation',
  floorSelectionHint: 'Choose a floor; select it again to reset the camera.',
  checkingMqtt: 'Checking MQTT...',
  mutationAccess_checking: 'Checking control access. Changes are disabled until access is confirmed; viewing and navigation remain available.',
  mutationAccess_enabled: 'Local controls are available.',
  mutationAccess_viewOnly: 'View-only simulator. Changes are disabled for this deployment; viewing and navigation remain available.',
  mutationAccess_unavailable: 'Control access is unavailable. Changes are disabled until access can be confirmed; viewing and navigation remain available.',
  editorUnavailableHost: 'Building editing is unavailable on this host. Use a direct loopback development host to edit.',
  requestNoDetail: 'No additional error detail is available.',
  buildingFloors: 'Building floors',
  building: 'Building',
  allFloors: 'All floors',
  loadingFloors: 'Loading floors...',
  scenarios: 'Scenarios',
  resetBuilding: 'Reset building',
  occupancyDemo: 'Occupancy demo',
  occupancyDemoTitle: 'Randomly occupy up to 2 rooms on each floor',
  simulatorView: '3D building view',
  simulatorCanvas: 'Interactive 3D view of the building. Use the accessible controls below to select rooms and trigger sensors or faults.',
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
  buildingDesignMismatch: 'The running building layout does not match the controller state.',
  buildingDesignStatusLoading: 'Checking building design...',
  buildingDesignStatusUnavailable: 'Building design status unavailable.',
  buildingDesignRefreshFailed: 'The building view could not be refreshed: {error}',
  buildingDesignStatusSummary: 'Building: {status}; saved revision {saved}, running revision {running}. Cleanup: {pending} pending, {failed} failed, {completed} completed.',
  statusChangedDuringRefresh: 'Status changed during refresh; reload the page.',
  mqttConnected: 'MQTT connected',
  mqttUnavailableHttpActive: 'MQTT unavailable · HTTP active',
  transportStatusUnavailable: 'Transport status unavailable',
  actionStatusRefreshFailed: 'Action applied, but status refresh failed: {error}',
  scenarioStatusRefreshFailed: 'Scenario applied, but status refresh failed: {error}',
  floorListUnavailable: 'Floor list unavailable.',
  unableToLoadBuildingState: 'Unable to load building state: {error}',
  editorMenu: 'Building menu',
  editBuilding: 'Edit building',
  editorLoading: 'Loading editor…',
  editorLoadFailed: 'Editor unavailable: {error}',
  editorRetry: 'Retry',
  editorReturn: 'Return to simulator',
  editorSaved: 'Saved design',
  editorDirty: 'Unsaved changes are only kept in this editor until saved.',
  editorConflict: 'The saved design changed. Export your local changes, then load the current design and manually reapply them.',
  editorSaveFailed: 'Save failed: {error}',
  editorSaveSuccess: 'Design saved. {status}',
  editorActivation: 'Activation: {status}',
  editorActivationActive: 'active',
  editorActivationPending: 'pending',
  editorActivationFailed: 'failed',
  editorRevisions: 'Saved revision {saved}; running revision {running}.',
  editorCleanup: 'Controller cleanup: {pending} pending, {failed} failed, {completed} completed, {cancelled} cancelled.',
  editorCleanupUnavailable: 'Controller cleanup status unavailable.',
  editorUnappliedFormStatus: 'Unapplied form changes have not been added to the design.',
  editorRetryActivation: 'Retry activation',
  editorRetryCleanup: 'Retry controller cleanup',
  editorStatusRefreshFailed: 'Activation and cleanup status could not be refreshed: {error}',
  editorProtocolError: 'The server did not return a valid edit revision.',
  editorUnknownStatus: 'Status unavailable',
  editorSave: 'Save and activate',
  editorUndo: 'Undo',
  editorRedo: 'Redo',
  editorHistory: 'Undo and redo are available only in this editor session, including after saving.',
  editorExit: 'Exit editor',
  editorUnsafeExit: 'The latest changes are not stored. Exit and lose local changes?',
  editorExitConfirm: 'Leave the editor and discard your unsaved changes?',
  editorUnapplied: 'There are unapplied form changes. Discard them and continue? Cancel to return and apply them.',
  editorValidationLocation: 'Floor {floor}: {error}',
  editorValidationBuilding: 'Building: {error}',
  editorValidationUnapplied: '{error} Apply or discard your pending form changes before navigating to the problem.',
  editorPendingProjectionInvalid: 'Pending form values cannot be applied as a valid design.',
  editorRecoveryExported: 'Downloaded recovery JSON. It contains the unchanged design and raw unapplied values; it is not a validated design.',
  editorNumericInputHelp: 'Enter a number. Use the arrow keys to adjust by the allowed increment.',
  editorNumericConstraint: 'Enter a number within the allowed range and increment.',
  editorResizeFixtures: 'Resize would leave a sensor or light outside the room, or a door off its boundary. Move the affected items first.',
  editorExport: 'Export local design',
  editorUseCurrent: 'Discard local changes and load saved design',
  editorUseCurrentConfirm: 'Discard local changes and load the saved design? Export first if needed.',
  editorBeforeUnload: 'Changes may not be stored.',
  editorBuilding: 'Building',
  editorWidth: 'Building width (m)',
  editorDepth: 'Building depth (m)',
  editorFloorCount: 'Number of floors',
  editorApply: 'Apply',
  editorFloors: 'Floor',
  editorFloor: 'Floor {number}',
  editorFloorRemove: 'Remove {floors} floor(s), {rooms} room(s), {doors} door(s), {lights} light(s), their sensors and controllers?',
  editorRoomRemove: 'Delete {room}, its sensor, {doors} door(s) and {lights} light(s)?',
  editorDeleteConfirm: 'Delete {item}?',
  editorPlan: 'Floor plan',
  editorPlanHelp: 'Select an item on the plan or in the list. Choose a placement tool and click the plan; use the forms for precise positions. Connections are illustrative.',
  editorTool: 'Plan tool',
  editorSelect: 'Select',
  editorAddRoom: 'Add room',
  editorAddDoor: 'Add door',
  editorAddLight: 'Add light',
  editorMove: 'Move selected item',
  editorItems: 'Items and connections',
  editorController: 'Floor controller',
  editorRoom: 'Room: {name}',
  editorSensor: 'Sensor: {room}',
  editorDoor: 'Door {number}: {room}',
  editorLight: 'Light {number}: {room}',
  editorConnected: 'Connected to floor controller',
  editorDisconnected: 'Not connected',
  editorProperties: 'Selected item properties',
  editorName: 'Room name',
  editorX: 'X (m)',
  editorZ: 'Z (m)',
  editorRoomWidth: 'Room width (m)',
  editorRoomDepth: 'Room depth (m)',
  editorConnection: 'Connection',
  editorNoConnection: 'Not connected',
  editorDelete: 'Delete selected item',
  editorNoRooms: 'No rooms on this floor. Add a room using the plan or the form.',
  editorNewRoom: 'New room',
  editorAddRoomForm: 'Add room with these properties',
  editorSelectRoom: 'Select a room or one of its items first.',
  editorInvalid: 'Cannot save: {error}',
  editorInvalidBuilding: 'Building dimensions must be 2–100 m on the 0.5 m grid, with 1–10 floors.',
  editorInvalidRoom: '{room}: enter a name and a non-overlapping room at least 1 m wide and deep within the building, on the 0.5 m grid.',
  editorRoomNameTooLong: 'Room names must be 256 characters or fewer.',
  editorInvalidPoint: '{item}: position must be within its bounds on the 0.5 m grid.',
  editorInvalidDoor: '{item}: place the door on its room boundary.',
  editorInvalidConnection: '{item}: connect it to its floor controller.',
  editorClickRoom: 'Choose a room before placing a door or light.',
  editorNoMove: 'Select a controller, room, sensor, door or light to move.',
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
