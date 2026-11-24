export function sensorFaultForRoom(controller, room) {
  const sensorId = room.sensorId ?? `sensor-floor-${controller.floor}-${room.id.slice(`floor-${controller.floor}-`.length)}`;
  return controller.faults.find(fault => fault.scope === 'sensor' && fault.targetId === sensorId);
}

export function sensorPulseAmount(faulted, reducedMotion, timeMs) {
  if (!faulted || reducedMotion) return 0;
  return (1 - Math.cos(timeMs * 2 * Math.PI / 2400)) / 2;
}

export function selectedRoomVisualState(presence, sensorFaulted) {
  return {
    surfaceColor: presence ? '#173c3a' : '#1e3a5f',
    outlineColor: '#38bdf8',
    wallColor: '#38bdf8',
    sensorColor: sensorFaulted ? '#ef4444' : presence ? '#22c55e' : '#f8fafc',
    sensorEmissive: sensorFaulted ? '#7f1d1d' : presence ? '#14532d' : '#20252b'
  };
}

export function lightVisualState(strip) {
  return {
    color: strip.isFaulted ? '#ef4444' : strip.isOn ? '#fde047' : '#64748b',
    emissive: strip.isFaulted ? '#7f1d1d' : strip.isOn ? '#a16207' : '#000000',
    emissiveIntensity: strip.isOn || strip.isFaulted ? 0.6 : 0
  };
}

export function roomIllumination(lightStrips) {
  if (lightStrips.length === 0) return 0;
  const active = lightStrips.filter(lightEmits).length;
  return active / lightStrips.length;
}

export function lightEmits(strip) {
  return strip.isOn && !strip.isFaulted;
}
