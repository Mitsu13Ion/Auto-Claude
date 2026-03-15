import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod';

const mockGenerateText = vi.fn();

vi.mock('ai', () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
  Output: {
    object: ({ schema }: { schema: unknown }) => ({ schema }),
  },
}));

import { repairJsonWithLLM } from '../structured-output';

describe('repairJsonWithLLM', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'repair-usage-'));
    mockGenerateText.mockReset();
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('returns auxiliary token usage from the repair call', async () => {
    const filePath = join(testDir, 'implementation_plan.json');
    writeFileSync(filePath, JSON.stringify({ phases: [{ name: 'Setup' }] }));

    mockGenerateText.mockResolvedValue({
      output: {
        feature: 'Setup project',
        phases: [{
          id: '1',
          name: 'Setup',
          subtasks: [{ id: '1-1', title: 'Init', status: 'pending' }],
        }],
      },
      usage: { inputTokens: 120, outputTokens: 40, totalTokens: 160 },
    });

    const result = await repairJsonWithLLM(
      filePath,
      z.object({
        feature: z.string(),
        phases: z.array(z.object({
          id: z.string(),
          name: z.string(),
          subtasks: z.array(z.object({
            id: z.string(),
            title: z.string(),
            status: z.string(),
          })),
        })),
      }),
      z.object({
        feature: z.string(),
        phases: z.array(z.object({
          id: z.string(),
          name: z.string(),
          subtasks: z.array(z.object({
            id: z.string(),
            title: z.string(),
            status: z.string(),
          })),
        })),
      }),
      {} as never,
      ['At "phases": array must have at least 1 item(s)'],
    );

    expect(result.valid).toBe(true);
    expect(result.usage).toMatchObject({
      promptTokens: 120,
      completionTokens: 40,
      totalTokens: 160,
    });
  });
});
