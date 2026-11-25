import type { ControllerDto, LightStripDto, RoomDto } from '../shared/simulator-model.js';

export function sensorFaultForRoom(controller: ControllerDto, room: RoomDto) {
  const sensorId = room.sensorId ?? `sensor-floor-${controller.floor}-${room.id.slice(`floor-${controller.floor}-`.length)}`;
  return controller.faults.find(fault => fault.scope === 'sensor' && fault.targetId === sensorId);
}

export function sensorPulseAmount(faulted: boolean, reducedMotion: boolean, timeMs: number): number {
  if (!faulted || reducedMotion) return 0;
  return (1 - Math.cos(timeMs * 2 * Math.PI / 2400)) / 2;
}

export function selectedRoomVisualState(presence: boolean, sensorFaulted: boolean) {
  return {
    surfaceColor: '#475569',
    outlineColor: '#f8fafc',
    wallColor: '#94a3b8',
    sensorColor: sensorFaulted ? '#ef4444' : presence ? '#22c55e' : '#f8fafc',
    sensorEmissive: sensorFaulted ? '#7f1d1d' : presence ? '#14532d' : '#20252b'
  };
}

export function lightVisualState(strip: LightStripDto) {
  return {
    color: strip.isFaulted ? '#ef4444' : strip.isOn ? '#fde047' : '#64748b',
    emissive: strip.isFaulted ? '#7f1d1d' : strip.isOn ? '#a16207' : '#000000',
    emissiveIntensity: strip.isOn || strip.isFaulted ? 0.6 : 0
  };
}

export function roomIllumination(lightStrips: readonly LightStripDto[]): number {
  if (lightStrips.length === 0) return 0;
  const active = lightStrips.filter(lightEmits).length;
  return active / lightStrips.length;
}

export function lightEmits(strip: LightStripDto): boolean {
  return strip.isOn && !strip.isFaulted;
}
