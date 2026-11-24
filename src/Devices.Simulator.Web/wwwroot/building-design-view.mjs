export function designRoomView(design, room, floorY) {
  const toX = value => value - design.width / 2;
  const toZ = value => value - design.depth / 2;
  const left = toX(room.x);
  const right = toX(room.x + room.width);
  const front = toZ(room.z);
  const back = toZ(room.z + room.depth);
  const doors = room.doors.map(door => {
    const x = toX(door.x);
    const z = toZ(door.z);
    if (door.z === room.z) return { side: 'front', center: x };
    if (door.z === room.z + room.depth) return { side: 'back', center: x };
    if (door.x === room.x) return { side: 'left', center: z };
    return { side: 'right', center: z };
  });
  return {
    area: { x: (left + right) / 2, z: (front + back) / 2, width: room.width, depth: room.depth, doors },
    fixtures: {
      lights: room.lights.map(light => ({ x: toX(light.x), y: floorY + 1.16, z: toZ(light.z) })),
      sensor: { x: toX(room.sensor.x), y: floorY + 1.25, z: toZ(room.sensor.z) },
      sensorConnection: { x: toX(room.sensor.x), y: floorY + 1.4, z: toZ(room.sensor.z) }
    }
  };
}

export function designControllerPosition(design, floor, floorY) {
  return { x: floor.controllerX - design.width / 2, y: floorY + 0.38, z: floor.controllerZ - design.depth / 2 };
}

export async function syncRunningDesign(runningRevision, displayedRevision, refresh) {
  if (runningRevision !== displayedRevision) await refresh();
}
