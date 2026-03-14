import { describe, expect, it } from 'vitest';

import { buildToolRegistry } from '../build-registry';

describe('buildToolRegistry', () => {
  it('registers auto-claude builtin tools', () => {
    const registry = buildToolRegistry();

    expect(registry.getRegisteredNames()).toEqual(
      expect.arrayContaining([
        'mcp__auto-claude__get_build_progress',
        'mcp__auto-claude__update_subtask_status',
        'mcp__auto-claude__update_qa_status',
      ]),
    );
  });
});
