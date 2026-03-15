import { describe, expect, it } from 'vitest';

import { compactProjectInstructions } from '../prompt-loader';

describe('compactProjectInstructions', () => {
  it('leaves short instruction files untouched', () => {
    const content = '# Rules\nKeep tests green.';
    expect(compactProjectInstructions(content)).toBe(content);
  });

  it('truncates oversized instruction files while preserving both ends', () => {
    const content = `${'A'.repeat(7000)}${'B'.repeat(3000)}`;

    const compacted = compactProjectInstructions(content);

    expect(compacted.length).toBeLessThan(content.length);
    expect(compacted).toContain('project instructions truncated');
    expect(compacted.startsWith('A'.repeat(100))).toBe(true);
    expect(compacted.endsWith('B'.repeat(100))).toBe(true);
  });
});
