import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockExistsSync = vi.fn();
const mockFindExecutable = vi.fn();
const mockReadSettingsFile = vi.fn();

vi.mock('node:fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
}));

vi.mock('../../../platform', () => ({
  findExecutable: (...args: unknown[]) => mockFindExecutable(...args),
}));

vi.mock('../../../settings-utils', () => ({
  readSettingsFile: () => mockReadSettingsFile(),
}));

import { resolveTokfToolConfig } from '../tokf';

describe('resolveTokfToolConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
    mockFindExecutable.mockReturnValue(null);
    mockReadSettingsFile.mockReturnValue(undefined);
    delete process.env.TOKF_PATH;
  });

  it('detects tokf from Linuxbrew fallback paths', () => {
    mockReadSettingsFile.mockReturnValue({ tokfEnabled: true });
    mockFindExecutable.mockReturnValue('/home/linuxbrew/.linuxbrew/bin/tokf');

    const result = resolveTokfToolConfig();

    expect(result).toEqual({ path: '/home/linuxbrew/.linuxbrew/bin/tokf' });
    expect(mockFindExecutable).toHaveBeenCalledWith(
      'tokf',
      expect.arrayContaining(['/home/linuxbrew/.linuxbrew/bin']),
    );
  });

  it('falls back to autodetection when TOKF_PATH points to a missing binary', () => {
    mockReadSettingsFile.mockReturnValue({ tokfEnabled: true });
    process.env.TOKF_PATH = '/missing/tokf';
    mockFindExecutable.mockReturnValue('/usr/local/bin/tokf');

    const result = resolveTokfToolConfig();

    expect(result).toEqual({ path: '/usr/local/bin/tokf' });
    expect(mockExistsSync).toHaveBeenCalledWith('/missing/tokf');
    expect(mockFindExecutable).toHaveBeenCalledWith(
      'tokf',
      expect.arrayContaining(['/home/linuxbrew/.linuxbrew/bin']),
    );
  });

  it('uses TOKF_PATH when it points to an existing binary', () => {
    mockReadSettingsFile.mockReturnValue({ tokfEnabled: true });
    process.env.TOKF_PATH = '/custom/bin/tokf';
    mockExistsSync.mockImplementation((candidate: string) => candidate === '/custom/bin/tokf');

    const result = resolveTokfToolConfig();

    expect(result).toEqual({ path: '/custom/bin/tokf' });
    expect(mockFindExecutable).not.toHaveBeenCalled();
  });

  it('respects tokfEnabled=false', () => {
    mockReadSettingsFile.mockReturnValue({ tokfEnabled: false });

    const result = resolveTokfToolConfig();

    expect(result).toBeUndefined();
    expect(mockFindExecutable).not.toHaveBeenCalled();
  });

  it('defaults to disabled until explicitly enabled', () => {
    mockFindExecutable.mockReturnValue('/home/linuxbrew/.linuxbrew/bin/tokf');

    const result = resolveTokfToolConfig();

    expect(result).toBeUndefined();
    expect(mockFindExecutable).not.toHaveBeenCalled();
  });

  it('resolves tokf when explicitly enabled', () => {
    mockReadSettingsFile.mockReturnValue({ tokfEnabled: true });
    mockFindExecutable.mockReturnValue('/home/linuxbrew/.linuxbrew/bin/tokf');

    const result = resolveTokfToolConfig();

    expect(result).toEqual({ path: '/home/linuxbrew/.linuxbrew/bin/tokf' });
    expect(mockFindExecutable).toHaveBeenCalledWith(
      'tokf',
      expect.arrayContaining(['/home/linuxbrew/.linuxbrew/bin']),
    );
  });
});
