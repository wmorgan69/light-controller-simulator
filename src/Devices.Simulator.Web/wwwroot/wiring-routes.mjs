export function isWiringVisible(selectedFloor, floor) {
  return selectedFloor !== null && selectedFloor === floor;
}

export function wiringRoute(controller, device, ceilingHeight) {
  const points = [
    controller,
    { x: controller.x, y: ceilingHeight, z: controller.z },
    { x: device.x, y: ceilingHeight, z: controller.z },
    { x: device.x, y: ceilingHeight, z: device.z },
    device
  ];

  return points.filter((point, index) => {
    const previous = points[index - 1];
    return !previous || point.x !== previous.x || point.y !== previous.y || point.z !== previous.z;
  });
}
