import type {
  ControllerDto,
  ControllerFaultDto,
  DeviceTelemetryDto,
  LightStripDto,
  RoomDto,
  TelemetrySnapshot,
  TelemetryTotals,
  TransportStatusDto
} from './types';

type JsonRecord = Record<string, unknown>;

export interface FetchResponse {
  ok: boolean;
  json(): Promise<unknown>;
}

export type TelemetryFetcher = (
  input: string,
  init: RequestInit
) => Promise<FetchResponse>;

export interface PollingOptions {
  fetcher: TelemetryFetcher;
  onSnapshot(snapshot: TelemetrySnapshot): void;
  onError(error: unknown): void;
  schedule(callback: () => void, delay: number): number;
  cancel(timer: number): void;
  setTimeout?(callback: () => void, delay: number): ReturnType<typeof setTimeout>;
  clearTimeout?(timer: ReturnType<typeof setTimeout>): void;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasString(record: JsonRecord, key: string): boolean {
  return typeof record[key] === 'string';
}

function isArrayOf<T>(value: unknown, predicate: (item: unknown) => item is T): value is T[] {
  return Array.isArray(value) && value.every(predicate);
}

function isLightStrip(value: unknown): value is LightStripDto {
  return isRecord(value) &&
    hasString(value, 'id') &&
    hasString(value, 'roomId') &&
    typeof value.isOn === 'boolean' &&
    typeof value.isFaulted === 'boolean';
}

function isRoom(value: unknown): value is RoomDto {
  return isRecord(value) &&
    hasString(value, 'id') &&
    hasString(value, 'name') &&
    hasString(value, 'controllerId') &&
    typeof value.sensorTriggered === 'boolean' &&
    typeof value.presence === 'boolean' &&
    isArrayOf(value.lightStrips, isLightStrip) &&
    (value.sensorId === undefined || value.sensorId === null || typeof value.sensorId === 'string');
}

function isControllerFault(value: unknown): value is ControllerFaultDto {
  return isRecord(value) &&
    hasString(value, 'id') &&
    hasString(value, 'scope') &&
    hasString(value, 'targetId') &&
    hasString(value, 'description');
}

function isController(value: unknown): value is ControllerDto {
  return isRecord(value) &&
    hasString(value, 'id') &&
    typeof value.floor === 'number' &&
    Number.isInteger(value.floor) &&
    hasString(value, 'status') &&
    hasString(value, 'lastSeen') &&
    isArrayOf(value.rooms, isRoom) &&
    isArrayOf(value.faults, isControllerFault) &&
    typeof value.revision === 'number' &&
    Number.isInteger(value.revision);
}

function isDeviceTelemetry(value: unknown): value is DeviceTelemetryDto {
  return isRecord(value) &&
    hasString(value, 'eventId') &&
    hasString(value, 'controllerId') &&
    hasString(value, 'eventType') &&
    hasString(value, 'timestamp') &&
    isController(value.state);
}

function isTransportStatus(value: unknown): value is TransportStatusDto {
  return isRecord(value) &&
    typeof value.mqttConnected === 'boolean' &&
    typeof value.httpAvailable === 'boolean' &&
    (value.lastMqttConnectedAt === null || typeof value.lastMqttConnectedAt === 'string') &&
    hasString(value, 'message') &&
    (value.simulatorHttpSource === undefined || value.simulatorHttpSource === null || typeof value.simulatorHttpSource === 'string');
}

function parseSnapshot(controllers: unknown, events: unknown, transport: unknown): TelemetrySnapshot {
  if (!isArrayOf(controllers, isController) ||
      !isArrayOf(events, isDeviceTelemetry) ||
      !isTransportStatus(transport)) {
    throw new Error('Invalid instrumentation API response');
  }
  return { controllers, events, transport };
}

export function getTotals(controllers: readonly ControllerDto[]): TelemetryTotals {
  return controllers.reduce<TelemetryTotals>((totals, controller) => {
    const rooms = controller.rooms;
    const status = controller.status.toLowerCase();
    totals.controllers++;
    totals.online += status === 'healthy' || status === 'faulted' ? 1 : 0;
    totals.faulted += status === 'faulted' ? 1 : 0;
    totals.faults += controller.faults.length;
    totals.rooms += rooms.length;
    totals.presence += rooms.filter(room => room.presence).length;
    for (const room of rooms) {
      for (const strip of room.lightStrips) {
        totals.strips++;
        totals.lightsOn += strip.isOn && !strip.isFaulted ? 1 : 0;
        totals.stripsFaulted += strip.isFaulted ? 1 : 0;
      }
    }
    return totals;
  }, { controllers: 0, online: 0, faulted: 0, faults: 0, rooms: 0, presence: 0, strips: 0, lightsOn: 0, stripsFaulted: 0 });
}

export function startTelemetryPolling({
  fetcher,
  onSnapshot,
  onError,
  schedule,
  cancel,
  setTimeout: startTimeout = globalThis.setTimeout,
  clearTimeout: clearTimeoutTimer = globalThis.clearTimeout
}: PollingOptions): () => void {
  let active = true;
  let inProgress = false;
  let abort: AbortController | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  async function refresh(): Promise<void> {
    if (!active || inProgress) return;
    inProgress = true;
    const requestAbort = new AbortController();
    abort = requestAbort;
    try {
      const request = async (): Promise<TelemetrySnapshot> => {
        const responses = await Promise.all(['/api/telemetry', '/api/events', '/api/status']
          .map(url => fetcher(url, { signal: requestAbort.signal })));
        if (responses.some(response => !response.ok)) {
          throw new Error('Instrumentation API request failed');
        }
        const [controllers, events, transport] = await Promise.all(responses.map(response => response.json()));
        return parseSnapshot(controllers, events, transport);
      };
      const deadline = new Promise<never>((_, reject) => {
        timeout = startTimeout(() => {
          requestAbort.abort();
          reject(new Error('Instrumentation API request timed out'));
        }, 5000);
      });
      const snapshot = await Promise.race([request(), deadline]);
      if (active) onSnapshot(snapshot);
    } catch (error: unknown) {
      if (active) onError(error);
    } finally {
      if (timeout !== undefined) clearTimeoutTimer(timeout);
      timeout = undefined;
      requestAbort.abort();
      inProgress = false;
    }
  }

  void refresh();
  const timer = schedule(refresh, 1000);
  return () => {
    active = false;
    cancel(timer);
    if (timeout !== undefined) clearTimeoutTimer(timeout);
    timeout = undefined;
    abort?.abort();
  };
}
