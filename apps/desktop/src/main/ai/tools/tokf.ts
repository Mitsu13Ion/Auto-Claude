import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { DEFAULT_APP_SETTINGS } from '../../../shared/constants';
import type { AppSettings } from '../../../shared/types';
import { findExecutable } from '../../platform';
import { readSettingsFile } from '../../settings-utils';
import type { TokfToolConfig } from './types';

const TOKF_SEARCH_PATHS = Array.from(new Set([
  path.join(homedir(), '.linuxbrew', 'bin'),
  '/home/linuxbrew/.linuxbrew/bin',
]));

function findTokfBinary(binaryName = 'tokf'): string | undefined {
  return findExecutable(binaryName, TOKF_SEARCH_PATHS) || undefined;
}

function resolveBinaryCandidate(candidate?: string): string | undefined {
  const trimmed = candidate?.trim();
  if (!trimmed) {
    return undefined;
  }

  const looksLikeFilePath =
    path.isAbsolute(trimmed) ||
    trimmed.startsWith('.') ||
    trimmed.includes('/') ||
    trimmed.includes('\\');

  if (looksLikeFilePath) {
    return existsSync(trimmed) ? trimmed : undefined;
  }

  return findTokfBinary(trimmed);
}

function resolveConfiguredBinary(configuredPath?: string): string | undefined {
  const configuredBinary = resolveBinaryCandidate(configuredPath);
  if (configuredPath?.trim()) {
    return configuredBinary;
  }

  const envPath = process.env.TOKF_PATH?.trim();
  return resolveBinaryCandidate(envPath) ?? findTokfBinary();
}

export function resolveTokfToolConfig(
  settingsOverride?: Partial<AppSettings>,
): TokfToolConfig | undefined {
  let savedSettings: Record<string, unknown> | undefined;
  try {
    savedSettings = readSettingsFile();
  } catch {
    savedSettings = undefined;
  }
  const settings = {
    ...DEFAULT_APP_SETTINGS,
    ...(savedSettings ?? {}),
    ...(settingsOverride ?? {}),
  } as AppSettings;

  if (settings.tokfEnabled === false) {
    return undefined;
  }

  const binaryPath = resolveConfiguredBinary(settings.tokfPath);
  if (!binaryPath) {
    return undefined;
  }

  return { path: binaryPath };
}
