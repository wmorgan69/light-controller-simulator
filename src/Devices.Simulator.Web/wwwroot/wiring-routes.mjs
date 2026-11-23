export function isWiringVisible(selectedFloor, floor) {
  return selectedFloor !== null && selectedFloor === floor;
}

export function wiringRoute(controller, device, ceilingHeight, offset = 0) {
  const points = offset === 0 ? [
    controller,
    { x: controller.x, y: ceilingHeight, z: controller.z },
    { x: device.x, y: ceilingHeight, z: controller.z },
    { x: device.x, y: ceilingHeight, z: device.z },
    device
  ] : [
    controller,
    { x: controller.x + offset, y: controller.y, z: controller.z },
    { x: controller.x + offset, y: controller.y, z: controller.z + offset },
    { x: controller.x + offset, y: ceilingHeight + offset, z: controller.z + offset },
    { x: device.x, y: ceilingHeight + offset, z: controller.z + offset },
    { x: device.x, y: ceilingHeight + offset, z: device.z },
    device
  ];

  return points.filter((point, index) => {
    const previous = points[index - 1];
    return !previous || point.x !== previous.x || point.y !== previous.y || point.z !== previous.z;
  });
}
