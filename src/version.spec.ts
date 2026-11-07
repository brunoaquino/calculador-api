import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readAppVersion } from './version';

describe('readAppVersion', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'calculador-version-'));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('reads the application version from the project package.json', () => {
    expect(readAppVersion()).toBe('1.0.0');
  });

  it('reads a version from an explicit file', () => {
    const path = join(directory, 'package.json');
    writeFileSync(path, JSON.stringify({ version: '9.9.9' }));

    expect(readAppVersion(path)).toBe('9.9.9');
  });

  it('fails when the file is missing', () => {
    const path = join(directory, 'missing.json');

    expect(() => readAppVersion(path)).toThrow(`Unable to read package.json at ${path}`);
  });

  it('fails when the file is not JSON', () => {
    const path = join(directory, 'package.json');
    writeFileSync(path, '{');

    expect(() => readAppVersion(path)).toThrow(`Invalid JSON in ${path}`);
  });

  it.each([
    ['null', 'null'],
    ['an array', '[]'],
    ['a string', '"1.0.0"'],
    ['an object without version', '{}'],
    ['a numeric version', '{"version":1}'],
    ['an empty version', '{"version":""}'],
  ])('fails when package.json is %s', (_label, contents) => {
    const path = join(directory, 'package.json');
    writeFileSync(path, contents);

    expect(() => readAppVersion(path)).toThrow(`Missing string version in ${path}`);
  });
});
