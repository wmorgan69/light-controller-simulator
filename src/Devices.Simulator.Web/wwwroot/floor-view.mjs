export function isFloorVisible(selectedFloor, floor) {
  return selectedFloor === null || selectedFloor === floor;
}

export function applyFloorMaterialEmphasis(material, dimmed) {
  if (material.userData.preserveTransparency) return;
  material.opacity = dimmed ? 0.16 : 1;
  material.transparent = dimmed;
  material.depthWrite = !dimmed;
  material.needsUpdate = true;
}

export function floorNavigation(controllers, selectedFloor) {
  return [...controllers]
    .sort((a, b) => b.floor - a.floor)
    .map(controller => ({
      id: controller.id,
      floor: controller.floor,
      status: controller.status,
      selected: controller.floor === selectedFloor,
      occupiedRooms: controller.rooms.filter(room => room.presence).length,
      totalRooms: controller.rooms.length
    }));
}

export function fieldOfViewForAspect(aspect) {
  const halfFieldOfView = 42 * Math.PI / 360;
  return 2 * Math.atan(Math.tan(halfFieldOfView) * Math.max(1, 1.15 / aspect)) * 180 / Math.PI;
}

export function cameraPresetNeedsUpdate(previousWidth, width, presetActive) {
  return presetActive && (previousWidth > 760) !== (width > 760);
}

export function selectedFloorCamera(floor, viewportWidth) {
  const y = (floor - 1) * 2.45;
  const targetY = y + 0.3;
  const zoom = viewportWidth > 760 ? 1.08 : 1;
  return {
    position: { x: 10 * zoom, y: targetY + 7 * zoom, z: 12 * zoom },
    target: { x: 0, y: targetY, z: 0 }
  };
}

export class FloorView {
  current = null;

  select(floor) {
    this.current = floor;
  }

  showAll() {
    this.current = null;
  }
}
