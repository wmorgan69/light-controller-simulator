type PluralForms = { other: string } & Partial<Record<Intl.LDMLPluralRule, string>>;
type LocalizationValues = Record<string, unknown>;

const resources: Readonly<Record<string, string | PluralForms>> = Object.freeze({
  documentTitle: 'Lighting Instrumentation',
  brandLabel: 'Lighting instrumentation home',
  brandParent: 'Building systems',
  brandName: 'Lighting',
  connectionWaiting: 'Waiting for telemetry',
  liveMonitoring: 'LIVE MONITORING',
  pageTitle: 'Lighting overview',
  pageIntro: 'Controller health, room occupancy and lighting activity across the building.',
  updatesAutomatically: 'Updates automatically',
  buildingSummary: 'Building summary',
  buildingTotal: 'BUILDING TOTAL',
  activityTitle: 'Lighting activity',
  floorByFloor: 'FLOOR BY FLOOR',
  controllersTitle: 'Controllers',
  systemActivity: 'SYSTEM ACTIVITY',
  eventsTitle: 'Recent events',
  controllersOnline: 'Controllers online',
  totalControllers: 'of {count} total',
  activeFaults: 'Active faults',
  affectedControllers: {
    one: '{count} controller affected',
    other: '{count} controllers affected'
  },
  lightsOn: 'Lights on',
  fixtureTotal: 'of {count} fixtures',
  occupiedRooms: 'Occupied rooms',
  monitoredRooms: 'of {count} monitored',
  activityCaption: '{on} of {total} fixtures currently on',
  activityAriaLabel: '{on} lights on, {off} off, {faulted} faulted',
  on: 'On',
  off: 'Off',
  faulted: 'Faulted',
  noLightingData: 'Lighting data will appear when controllers report.',
  occupied: 'Occupied',
  vacant: 'Vacant',
  fixtureRowAriaLabel: '{on} of {total} lights on, {faulted} faulted',
  faultedFixtureCount: {
    one: '{count} faulted fixture',
    other: '{count} faulted fixtures'
  },
  faultedFixtureIdentities: 'Faulted fixtures: {ids}',
  controllersLastObservedOnline: 'Last observed online',
  lastObservedStatus: 'Last observed: {status}',
  activityCaptionObserved: '{on} of {total} fixtures last observed on',
  telemetryUnavailable: 'Live telemetry unavailable',
  lastObservedNotice: 'Neither MQTT nor HTTP fallback is available. All values below are last observed, not current. Retrying automatically.',
  retryingTelemetry: 'Live data unavailable. Retrying automatically.',
  fixtureTitle: '{id}: {state}',
  fixtureOn: 'on',
  fixtureOff: 'off',
  fixtureFaulted: 'faulted',
  noFixtures: 'No fixtures',
  floorCount: {
    one: '{count} FLOOR',
    other: '{count} FLOORS'
  },
  noRoomData: 'No room data reported.',
  floorLabel: 'Floor {floor}',
  controllerId: 'Controller ID: {id}',
  controllerStatusHealthy: 'Healthy',
  controllerStatusFaulted: 'Faulted',
  controllerStatusOffline: 'Offline',
  controllerLightingLoad: 'Lighting load',
  lightsOnTotal: ' / {count} on',
  activeFaultCount: {
    one: '{count} active fault',
    other: '{count} active faults'
  },
  waitingForTelemetry: 'Waiting for telemetry or simulator connection.',
  eventsShown: 'Showing {shown} of {total} available',
  eventsListLabel: 'Available recent events',
  showAllAvailableEvents: 'Show all available events',
  showFewerEvents: 'Show fewer events',
  unknownTime: 'Unknown time',
  eventTime: '{date} · {time}',
  defaultEvent: 'event',
  stateChangedEvent: 'state changed',
  faultChangedEvent: 'fault changed',
  noEvents: 'No events recorded yet.',
  apiRequestFailed: 'Instrumentation API request failed',
  mqttTransport: 'MQTT',
  mqttAndHttpTransport: 'MQTT + HTTP polling',
  httpFallbackTransport: 'HTTP fallback',
  noLiveTransport: 'No live transport',
  reportingStatus: {
    one: '{count} controller reporting · {transport}',
    other: '{count} controllers reporting · {transport}'
  },
  waitingForSimulatorTelemetry: 'Waiting for simulator telemetry',
  apiUnavailable: 'Instrumentation API unavailable',
  httpPollingDetails: 'HTTP polling: {state} · {source}',
  httpPollingAvailable: 'available',
  httpPollingUnavailable: 'unavailable',
  httpPollingSource: 'Source: {source}',
  httpPollingSourceNotReported: 'Source not reported',
  httpPollingUnknown: 'HTTP polling state and source unavailable.',
  liveSummaryUnavailable: 'Live summary unavailable.',
  lightingActivityUnavailable: 'Lighting activity unavailable.',
  controllerStateUnavailable: 'Could not load controller state. Check the instrumentation service.',
  recentEventsUnavailable: 'Recent events unavailable.'
});

export function localize(key: string, values: LocalizationValues = {}): string {
  if (!Object.hasOwn(resources, key)) {
    throw new RangeError(`Unknown English resource key: ${key}`);
  }

  let message = resources[key];
  if (typeof message !== 'string') {
    if (typeof values.count !== 'number' || !Number.isFinite(values.count)) {
      throw new TypeError(`English resource "${key}" requires a finite count`);
    }
    const category = new Intl.PluralRules('en').select(values.count);
    message = message[category] ?? message.other;
  }

  return message.replace(/\{(\w+)\}/g, (placeholder, name) => {
    if (!Object.hasOwn(values, name)) {
      throw new RangeError(`Missing "${name}" for English resource "${key}"`);
    }
    return String(values[name]);
  });
}

export function controllerStatusLabel(status: string): string {
  const keys: Record<string, string> = {
    healthy: 'controllerStatusHealthy',
    faulted: 'controllerStatusFaulted',
    offline: 'controllerStatusOffline'
  };
  const normalized = String(status ?? '').toLowerCase();
  return Object.hasOwn(keys, normalized) ? localize(keys[normalized]) : String(status ?? '');
}

export function eventTypeLabel(eventType: string): string {
  const keys: Record<string, string> = {
    'state.changed': 'stateChangedEvent',
    'fault.changed': 'faultChangedEvent'
  };
  return Object.hasOwn(keys, eventType)
    ? localize(keys[eventType])
    : eventType.replaceAll('.', ' ');
}
