import { afterEach, describe, expect, it, vi } from 'vitest';

import { getSpecsDir } from '../config';

describe('getSpecsDir', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the default auto build directory when unset', () => {
    expect(getSpecsDir(undefined)).toBe('.auto-claude/specs');
  });

  it('preserves safe project-relative custom directories', () => {
    expect(getSpecsDir('river/build-data')).toBe('river/build-data/specs');
  });

  it('falls back when autoBuildPath is absolute', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(getSpecsDir('/tmp/evil')).toBe('.auto-claude/specs');
    expect(warnSpy).toHaveBeenCalled();
  });

  it('falls back when autoBuildPath attempts traversal', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(getSpecsDir('../outside')).toBe('.auto-claude/specs');
    expect(warnSpy).toHaveBeenCalled();
  });
});
