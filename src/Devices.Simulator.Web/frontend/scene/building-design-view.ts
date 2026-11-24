import type { BuildingDesignDto, FloorDesignDto, RoomDesignDto } from '../shared/simulator-model.js';

type DoorSide = 'front' | 'back' | 'left' | 'right';

interface RoomDoorView {
  side: DoorSide;
  center: number;
}

interface RoomAreaView {
  x: number;
  z: number;
  width: number;
  depth: number;
  doors: RoomDoorView[];
}

interface RoomFixturePoint {
  x: number;
  y: number;
  z: number;
}

interface DesignRoomView {
  area: RoomAreaView;
  fixtures: {
    lights: RoomFixturePoint[];
    sensor: RoomFixturePoint;
    sensorConnection: RoomFixturePoint;
  };
}

export function designRoomView(
  design: BuildingDesignDto,
  room: RoomDesignDto,
  floorY: number
): DesignRoomView {
  const toX = (value: number): number => value - design.width / 2;
  const toZ = (value: number): number => value - design.depth / 2;
  const left = toX(room.x);
  const right = toX(room.x + room.width);
  const front = toZ(room.z);
  const back = toZ(room.z + room.depth);
  const doors: RoomDoorView[] = room.doors.map(door => {
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

export function designControllerPosition(
  design: BuildingDesignDto,
  floor: FloorDesignDto,
  floorY: number
): RoomFixturePoint {
  return { x: floor.controllerX - design.width / 2, y: floorY + 0.38, z: floor.controllerZ - design.depth / 2 };
}

export async function syncRunningDesign(
  runningRevision: number,
  displayedRevision: number | undefined,
  refresh: () => void | Promise<void>
): Promise<void> {
  if (runningRevision !== displayedRevision) await refresh();
}
