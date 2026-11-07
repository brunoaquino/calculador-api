import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isRecord } from './common/is-record';

export function readAppVersion(packageJsonPath = join(__dirname, '..', 'package.json')): string {
  let raw: string;
  try {
    raw = readFileSync(packageJsonPath, 'utf8');
  } catch {
    throw new Error(`Unable to read package.json at ${packageJsonPath}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`Invalid JSON in ${packageJsonPath}`);
  }

  if (!isPackageJson(parsed)) {
    throw new Error(`Missing string version in ${packageJsonPath}`);
  }

  return parsed.version;
}

function isPackageJson(value: unknown): value is { version: string } {
  return isRecord(value) && typeof value.version === 'string' && value.version.length > 0;
}
