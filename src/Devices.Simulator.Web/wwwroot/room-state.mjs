export function sensorFaultForRoom(controller, room) {
  const sensorId = `sensor-floor-${controller.floor}-${room.id.slice(`floor-${controller.floor}-`.length)}`;
  return controller.faults.find(fault => fault.scope === 'sensor' && fault.targetId === sensorId);
}

export function lightVisualState(strip) {
  return {
    color: strip.isFaulted ? '#ef4444' : strip.isOn ? '#fde047' : '#64748b',
    emissive: strip.isFaulted ? '#7f1d1d' : strip.isOn ? '#a16207' : '#000000',
    emissiveIntensity: strip.isOn || strip.isFaulted ? 0.6 : 0
  };
}
