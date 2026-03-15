import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod';

const { writeFileWithRetryMock, generateTextMock } = vi.hoisted(() => ({
  writeFileWithRetryMock: vi.fn<(filePath: string, data: string | Buffer) => Promise<void>>(),
  generateTextMock: vi.fn(),
}));

vi.mock('../../../utils/atomic-file', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/atomic-file')>();
  return {
    ...actual,
    writeFileWithRetry: writeFileWithRetryMock,
  };
});

vi.mock('ai', () => ({
  generateText: generateTextMock,
  Output: {
    object: ({ schema }: { schema: unknown }) => ({ schema }),
  },
}));

describe('structured-output atomic persistence', () => {
  const schema = z.object({
    name: z.string(),
    age: z.number(),
  });

  let testDir: string;

  beforeEach(() => {
    vi.resetModules();
    writeFileWithRetryMock.mockReset();
    generateTextMock.mockReset();
    testDir = mkdtempSync(join(tmpdir(), 'structured-output-atomic-'));

    writeFileWithRetryMock.mockImplementation(async (filePath, data) => {
      await writeFile(filePath, data);
    });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('uses writeFileWithRetry when normalizing a validated JSON file', async () => {
    const filePath = join(testDir, 'implementation_plan.json');
    writeFileSync(filePath, JSON.stringify({ name: 'Alice', age: 30 }));

    const { validateAndNormalizeJsonFile } = await import('../structured-output');
    const result = await validateAndNormalizeJsonFile(filePath, schema);

    expect(result.valid).toBe(true);
    expect(writeFileWithRetryMock).toHaveBeenCalledTimes(1);
    expect(writeFileWithRetryMock).toHaveBeenCalledWith(
      filePath,
      JSON.stringify({ name: 'Alice', age: 30 }, null, 2),
    );
  });

  it('uses writeFileWithRetry when persisting repaired JSON', async () => {
    const filePath = join(testDir, 'implementation_plan.json');
    writeFileSync(filePath, '{"name":"Alice","age":"30"}');
    generateTextMock.mockResolvedValue({
      output: { name: 'Alice', age: 30 },
    });

    const { repairJsonWithLLM } = await import('../structured-output');
    const result = await repairJsonWithLLM(
      filePath,
      schema,
      schema,
      {} as never,
      ['At "age": expected number'],
    );

    expect(result.valid).toBe(true);
    expect(writeFileWithRetryMock).toHaveBeenCalledTimes(1);
    expect(writeFileWithRetryMock).toHaveBeenCalledWith(
      filePath,
      JSON.stringify({ name: 'Alice', age: 30 }, null, 2),
    );
    expect(JSON.parse(readFileSync(filePath, 'utf-8'))).toEqual({ name: 'Alice', age: 30 });
  });
});
