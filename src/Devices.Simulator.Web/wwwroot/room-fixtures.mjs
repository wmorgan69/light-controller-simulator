export const sensorRadius = 0.17;

export function roomFixturePositions(area, floorY, lightCount) {
  const ceiling = floorY + 1.4;
  const lights = Array.from({ length: lightCount }, (_, index) => ({
    x: area.x + (lightCount === 4 ? (index % 2 === 0 ? -0.75 : 0.75) : 0),
    y: floorY + 1.16,
    z: area.z + (lightCount === 4 ? (index < 2 ? -0.8 : 0.8) : 0)
  }));
  return {
    ceiling,
    lights,
    sensor: { x: area.x, y: ceiling - sensorRadius, z: area.z + (lightCount === 4 ? 0 : 0.9) }
  };
}
