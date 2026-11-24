import type { BuildingDesignDto, StairDesignDto, WalkwayDesignDto } from './simulator-model.js';

const rounded = (value: number): number => Math.round(value * 100) / 100;

export function materializeLegacyAccess(design: BuildingDesignDto, newId: (prefix: string) => string): void {
  const baseline = design.revision <= 1;
  for (const floor of design.floors) {
    const addWalkway = (x: number, z: number, width: number, depth: number): WalkwayDesignDto =>
      ({ id: newId('walkway'), x: rounded(x), z: rounded(z), width: rounded(width), depth: rounded(depth) });
    if (floor.walkways == null) {
      const odd = floor.number % 2 === 1;
      if (baseline) {
        floor.walkways = [
          addWalkway(design.width / 2 - 0.1, design.depth / 2 - 2, 4.4, 0.6),
          addWalkway(design.width / 2 + (odd ? 0.18 : 3.42), design.depth / 2 - 3.81, 0.8, 1.81)
        ];
      } else {
        floor.walkways = [
          addWalkway(-1.2, -1.2, design.width + 2.4, 1.2),
          addWalkway(-1.2, design.depth, design.width + 2.4, 1.2),
          addWalkway(-1.2, 0, 1.2, design.depth),
          addWalkway(design.width, 0, 1.2, design.depth),
          addWalkway(design.width / 2 + (odd ? -2.02 : 1.2), -3.01, 0.82, 1.81)
        ];
      }
    }
    if (floor.stairs == null) {
      const odd = floor.number % 2 === 1;
      const stair: StairDesignDto = {
        id: newId('stair'),
        x: rounded(baseline ? design.width / 2 + 1 : design.width / 2 - 1.2),
        z: rounded(baseline ? design.depth / 2 + (odd ? -3.76 : -2.85) : (odd ? -2.96 : -2.05)),
        width: 2.4, depth: 0.8, direction: odd ? 'east' : 'west'
      };
      floor.stairs = floor.number < design.floors.length ? [stair] : [];
    }
  }
}
