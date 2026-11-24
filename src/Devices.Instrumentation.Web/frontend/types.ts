export interface LightStripDto {
  id: string;
  roomId: string;
  isOn: boolean;
  isFaulted: boolean;
}

export interface RoomDto {
  id: string;
  name: string;
  controllerId: string;
  sensorTriggered: boolean;
  presence: boolean;
  lightStrips: LightStripDto[];
  sensorId?: string | null;
}

export interface ControllerFaultDto {
  id: string;
  scope: string;
  targetId: string;
  description: string;
}

export interface ControllerDto {
  id: string;
  floor: number;
  status: string;
  lastSeen: string;
  rooms: RoomDto[];
  faults: ControllerFaultDto[];
  revision: number;
}

export interface DeviceTelemetryDto {
  eventId: string;
  controllerId: string;
  eventType: string;
  timestamp: string;
  state: ControllerDto;
}

export interface TransportStatusDto {
  mqttConnected: boolean;
  httpAvailable: boolean;
  lastMqttConnectedAt: string | null;
  message: string;
  simulatorHttpSource?: string | null;
}

export interface TelemetrySnapshot {
  controllers: ControllerDto[];
  events: DeviceTelemetryDto[];
  transport: TransportStatusDto;
}

export interface TelemetryTotals {
  controllers: number;
  online: number;
  faulted: number;
  faults: number;
  rooms: number;
  presence: number;
  strips: number;
  lightsOn: number;
  stripsFaulted: number;
}
