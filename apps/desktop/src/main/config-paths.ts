/**
 * Configuration Paths Module
 *
 * Provides XDG Base Directory Specification compliant paths for storing
 * application configuration and data. This is essential for AppImage,
 * Flatpak, and Snap installations where the application runs in a
 * sandboxed or immutable filesystem environment.
 *
 * XDG Base Directory Specification:
 * - $XDG_CONFIG_HOME: User configuration (default: ~/.config)
 * - $XDG_DATA_HOME: User data (default: ~/.local/share)
 * - $XDG_CACHE_HOME: User cache (default: ~/.cache)
 *
 * @see https://specifications.freedesktop.org/basedir-spec/basedir-spec-latest.html
 */

import * as path from 'path';
import * as os from 'os';
import { existsSync } from 'fs';
import { isLinux } from './platform';

const APP_NAME = 'rivercode';
const LEGACY_APP_NAME = 'auto-claude';

/**
 * Get the XDG config home directory
 * Uses $XDG_CONFIG_HOME if set, otherwise defaults to ~/.config
 */
export function getXdgConfigHome(): string {
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
}

/**
 * Get the XDG data home directory
 * Uses $XDG_DATA_HOME if set, otherwise defaults to ~/.local/share
 */
export function getXdgDataHome(): string {
  return process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
}

/**
 * Get the XDG cache home directory
 * Uses $XDG_CACHE_HOME if set, otherwise defaults to ~/.cache
 */
export function getXdgCacheHome(): string {
  return process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
}

/**
 * Get the application config directory
 * Returns the XDG-compliant path for storing configuration files.
 * Falls back to the legacy 'auto-claude' path if it exists and the new path doesn't.
 */
export function getAppConfigDir(): string {
  const newPath = path.join(getXdgConfigHome(), APP_NAME);
  if (existsSync(newPath)) {
    return newPath;
  }
  const legacyPath = path.join(getXdgConfigHome(), LEGACY_APP_NAME);
  if (existsSync(legacyPath)) {
    return legacyPath;
  }
  return newPath;
}

/**
 * Get the application data directory
 * Returns the XDG-compliant path for storing application data.
 * Falls back to the legacy 'auto-claude' path if it exists and the new path doesn't.
 */
export function getAppDataDir(): string {
  const newPath = path.join(getXdgDataHome(), APP_NAME);
  if (existsSync(newPath)) {
    return newPath;
  }
  const legacyPath = path.join(getXdgDataHome(), LEGACY_APP_NAME);
  if (existsSync(legacyPath)) {
    return legacyPath;
  }
  return newPath;
}

/**
 * Get the application cache directory
 * Returns the XDG-compliant path for storing cache files.
 * Falls back to the legacy 'auto-claude' path if it exists and the new path doesn't.
 */
export function getAppCacheDir(): string {
  const newPath = path.join(getXdgCacheHome(), APP_NAME);
  if (existsSync(newPath)) {
    return newPath;
  }
  const legacyPath = path.join(getXdgCacheHome(), LEGACY_APP_NAME);
  if (existsSync(legacyPath)) {
    return legacyPath;
  }
  return newPath;
}

/**
 * Get the memories storage directory
 * This is where graph databases are stored (previously ~/.auto-claude/memories)
 */
export function getMemoriesDir(): string {
  // For compatibility, we still support the legacy path
  const legacyPath = path.join(os.homedir(), '.auto-claude', 'memories');

  // On Linux with XDG variables set (AppImage, Flatpak, Snap), use XDG path
  // Uses LEGACY_APP_NAME to keep memories data in the same location for backward compatibility
  if (isLinux() && (process.env.XDG_DATA_HOME || process.env.APPIMAGE || process.env.SNAP || process.env.FLATPAK_ID)) {
    return path.join(getXdgDataHome(), LEGACY_APP_NAME, 'memories');
  }

  // Default to legacy path for backwards compatibility
  return legacyPath;
}

/**
 * Get the graphs storage directory (alias for memories)
 */
export function getGraphsDir(): string {
  return getMemoriesDir();
}

/**
 * Check if running in an immutable filesystem environment
 * (AppImage, Flatpak, Snap, etc.)
 */
export function isImmutableEnvironment(): boolean {
  return !!(
    process.env.APPIMAGE ||
    process.env.SNAP ||
    process.env.FLATPAK_ID
  );
}

/**
 * Get environment-appropriate path for a given type
 * Handles the differences between regular installs and sandboxed environments
 *
 * @param type - The type of path needed: 'config', 'data', 'cache', 'memories'
 * @returns The appropriate path for the current environment
 */
export function getAppPath(type: 'config' | 'data' | 'cache' | 'memories'): string {
  switch (type) {
    case 'config':
      return getAppConfigDir();
    case 'data':
      return getAppDataDir();
    case 'cache':
      return getAppCacheDir();
    case 'memories':
      return getMemoriesDir();
    default:
      return getAppDataDir();
  }
}
