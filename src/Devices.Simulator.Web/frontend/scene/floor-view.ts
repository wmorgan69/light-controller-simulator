import type { Material } from 'three';
import type { ControllerDto } from '../shared/simulator-model.js';

export function isFloorVisible(selectedFloor: number | null, floor: number): boolean {
  return selectedFloor === null || selectedFloor === floor;
}

export function applyFloorMaterialEmphasis(material: Material, dimmed: boolean): void {
  if (material.userData.preserveTransparency) return;
  material.opacity = dimmed ? 0.16 : 1;
  material.transparent = dimmed;
  material.depthWrite = !dimmed;
  material.needsUpdate = true;
}

export function floorNavigation(controllers: readonly ControllerDto[], selectedFloor: number | null) {
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

export function fieldOfViewForAspect(aspect: number): number {
  const halfFieldOfView = 42 * Math.PI / 360;
  return 2 * Math.atan(Math.tan(halfFieldOfView) * Math.max(1, 1.15 / aspect)) * 180 / Math.PI;
}

export function overviewCameraScale(width: number, depth: number, highestFloor: number): number {
  const radius = Math.hypot(width / 2, depth / 2, (highestFloor - 1) * 2.45 / 2 + 1.4);
  const distance = radius / Math.sin(21 * Math.PI / 180);
  return Math.max(1, width / 10, depth / 8, distance / Math.hypot(13, 10.7, 18));
}

export function cameraPresetNeedsUpdate(previousWidth: number, width: number, presetActive: boolean): boolean {
  return presetActive && (previousWidth > 760) !== (width > 760);
}

export function selectedFloorCamera(floor: number, viewportWidth: number) {
  const y = (floor - 1) * 2.45;
  const targetY = y + 0.3;
  const zoom = viewportWidth > 760 ? 1.08 : 1;
  return {
    position: { x: 10 * zoom, y: targetY + 7 * zoom, z: 12 * zoom },
    target: { x: 0, y: targetY, z: 0 }
  };
}

export class FloorView {
  current: number | null = null;

  select(floor: number): void {
    this.current = floor;
  }

  showAll(): void {
    this.current = null;
  }
}
