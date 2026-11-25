interface Point3 {
  x: number;
  y: number;
  z: number;
}

export function isWiringVisible(selectedFloor: number | null, floor: number): boolean {
  return selectedFloor !== null && selectedFloor === floor;
}

export function wiringRoute(
  controller: Point3,
  device: Point3,
  ceilingHeight: number,
  offset = 0,
  port?: { x: number; z: number }
): Point3[] {
  const points = offset === 0 ? [
    controller,
    { x: controller.x, y: ceilingHeight, z: controller.z },
    { x: device.x, y: ceilingHeight, z: controller.z },
    { x: device.x, y: ceilingHeight, z: device.z },
    device
  ] : [
    controller,
    { x: controller.x + (port?.x ?? offset), y: controller.y, z: controller.z },
    { x: controller.x + (port?.x ?? offset), y: controller.y, z: controller.z + (port?.z ?? offset) },
    { x: controller.x + (port?.x ?? offset), y: ceilingHeight + offset, z: controller.z + (port?.z ?? offset) },
    { x: device.x, y: ceilingHeight + offset, z: controller.z + (port?.z ?? offset) },
    { x: device.x, y: ceilingHeight + offset, z: device.z },
    device
  ];

  return points.filter((point, index) => {
    const previous = points[index - 1];
    return !previous || point.x !== previous.x || point.y !== previous.y || point.z !== previous.z;
  });
}
