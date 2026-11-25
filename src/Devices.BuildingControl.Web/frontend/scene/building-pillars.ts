import * as THREE from 'three';

export function createFloorPillars(baseY: number, endsAtCeiling: boolean): THREE.Group {
  const group = new THREE.Group();
  const height = endsAtCeiling ? 1.2 : 2.45;

  for (const x of [-4.94, 4.94]) {
    for (const z of [-3.94, 3.94]) {
      const pillar = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, height, 0.12),
        new THREE.MeshBasicMaterial({ color: '#94a3b8', transparent: true, opacity: 0.35, depthWrite: false }));
      pillar.position.set(x, baseY + height / 2, z);
      group.add(pillar);
    }
  }

  return group;
}

export function createDesignFloorPillars(
  baseY: number,
  endsAtCeiling: boolean,
  width: number,
  depth: number,
  walkwayWidth: number
): THREE.Group {
  const group = createFloorPillars(baseY, endsAtCeiling);
  for (const pillar of group.children) {
    pillar.position.x = Math.sign(pillar.position.x) * (width / 2 + walkwayWidth + 0.06);
    pillar.position.z = Math.sign(pillar.position.z) * (depth / 2 + walkwayWidth + 0.06);
  }
  return group;
}
