import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureBuildingLightingDemo } from '../docs/assets/record-demo.mjs';

test('rejects incomplete screencast support before changing simulator state', async () => {
  const methods = ['start', 'stop', 'showActions', 'showChapter'];
  for (const missing of methods) {
    const screencast = Object.fromEntries(methods.map(method => [method, () => {}]));
    delete screencast[missing];
    let visited = false;
    const page = { screencast, evaluate: () => { visited = true; } };
    await assert.rejects(captureBuildingLightingDemo(page, 'output'), /screencast support/);
    assert.equal(visited, false);
  }
});
