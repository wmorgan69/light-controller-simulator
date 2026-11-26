import assert from 'node:assert/strict';
import test from 'node:test';
import { ESLint } from 'eslint';

const eslint = new ESLint();
const filePath = 'src/Devices.BuildingControl.Web/frontend/lint-fixture.tsx';

async function ruleIds(source, options = {}) {
  const linter = Object.keys(options).length ? new ESLint(options) : eslint;
  const [result] = await linter.lintText(source, { filePath });
  assert.equal(result.fatalErrorCount, 0, 'fixture should parse as TypeScript and JSX');
  return result.messages.map(message => message.ruleId);
}

test('lint checks TypeScript, React hooks and JSX accessibility', async () => {
  assert.deepEqual(await ruleIds('function identity<T>(value: T): T { return value; }'), []);
  assert.ok((await ruleIds('export function Picture() { return <img src="x" />; }')).includes('jsx-a11y/alt-text'));
  assert.ok((await ruleIds('export function Status() { return <div aria-madeup="x" />; }')).includes('jsx-a11y/aria-props'));
  assert.ok((await ruleIds('export function Component({ ready }: { ready: boolean }) { if (ready) useEffect(() => {}, []); return null; }'))
    .includes('react-hooks/rules-of-hooks'));
});

test('accessibility rule handles glob-matched custom controls with the patched minimatch', async () => {
  const overrideConfig = {
    rules: {
      'jsx-a11y/label-has-associated-control': ['error', { controlComponents: ['Custom*'] }],
    },
  };
  assert.deepEqual(await ruleIds('export function Field() { return <label>Name <CustomInput /></label>; }', { overrideConfig }), []);
  assert.ok((await ruleIds('export function Field() { return <label>Name <OtherInput /></label>; }', { overrideConfig }))
    .includes('jsx-a11y/label-has-associated-control'));
});
