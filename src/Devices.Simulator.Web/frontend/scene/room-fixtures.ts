import type { LegacyRoomArea, RoomArea } from './building-access.js';

export const sensorRadius = 0.15;

type RoomLayout = Record<string, LegacyRoomArea>;

export function floorRoomLayout(floor: number, roomKeys: string[]): RoomLayout {
  const standard: RoomLayout = {
    main: { x: -2.4, z: 0, width: 4.7, depth: 7.1, door: { side: 'right', center: -1.7 } },
    'office-a': { x: 1.25, z: 0, width: 2.35, depth: 2.8, door: { side: 'front', center: 1.25 } },
    'office-b': { x: 3.8, z: 0, width: 2.35, depth: 2.8, door: { side: 'front', center: 3.8 } }
  };
  if (floor === 2 && !roomKeys.includes('office-b')) {
    return {
      main: { x: -1.125, z: 1.075, width: 7.25, depth: 4.95, door: { side: 'front', center: 0.4 } },
      'office-a': { ...standard['office-a'], x: 3.8, door: { side: 'front', center: 3.8 } }
    };
  }
  if (floor === 4 && !roomKeys.includes('office-a') && !roomKeys.includes('office-b')) {
    return { main: { x: 0, z: 1.075, width: 9.5, depth: 4.95, door: { side: 'front', center: 0.4 } } };
  }
  return standard;
}

export interface FixturePosition {
  x: number;
  y: number;
  z: number;
}

export interface RoomFixturePositions {
  ceiling: number;
  lights: FixturePosition[];
  sensor: FixturePosition;
  sensorConnection: FixturePosition;
}

export function roomFixturePositions(
  area: Pick<RoomArea, 'x' | 'z' | 'width' | 'depth'>,
  floorY: number,
  lightCount: number
): RoomFixturePositions {
  const ceiling = floorY + 1.4;
  const expandedColumns = lightCount === 8 || lightCount === 12 ? lightCount / 2 : 0;
  const lights = Array.from({ length: lightCount }, (_, index) => ({
    x: area.x + (expandedColumns ? (index % expandedColumns - (expandedColumns - 1) / 2)
      * (area.width - 1.5) / (expandedColumns - 1)
      : lightCount === 6 ? (index % 3 - 1) * 1.3
      : lightCount >= 4 ? (index % 2 === 0 ? -0.75 : 0.75) : 0),
    y: floorY + 1.16,
    z: area.z + (expandedColumns ? (index < expandedColumns ? -1 : 1) * area.depth * 0.24
      : lightCount === 6 ? (index < 3 ? -1.6 : 1.6)
      : lightCount >= 4 ? (index < 2 ? -0.8 : 0.8) : 0)
  }));
  const sensor = { x: area.x + 0.22, y: ceiling - sensorRadius, z: area.z + (lightCount >= 4 ? 0 : 0.9) };
  return {
    ceiling,
    lights,
    sensor,
    sensorConnection: { x: sensor.x, y: ceiling, z: sensor.z }
  };
}
