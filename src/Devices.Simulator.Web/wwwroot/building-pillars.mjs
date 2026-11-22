import * as THREE from './vendor/three.module.js';

export function createFloorPillars(baseY, endsAtCeiling) {
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
