import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

import { TaskLogWriter } from '../task-log-writer';

describe('TaskLogWriter', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('persists explicit error entries with detail', () => {
    const specDir = mkdtempSync(join(tmpdir(), 'task-log-writer-'));
    tempDirs.push(specDir);

    const writer = new TaskLogWriter(specDir, '050-test-task');
    writer.startPhase('coding');
    writer.logError('Implementation plan is invalid', 'coding', 'At "phases": array must have at least 1 item(s)');
    writer.endPhase('coding', false);

    const logFile = join(specDir, 'task_logs.json');
    const logs = JSON.parse(readFileSync(logFile, 'utf-8')) as {
      phases: {
        coding: {
          status: string;
          entries: Array<{ type: string; content: string; detail?: string }>;
        };
      };
    };

    expect(logs.phases.coding.status).toBe('failed');
    expect(logs.phases.coding.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'error',
          content: 'Implementation plan is invalid',
          detail: 'At "phases": array must have at least 1 item(s)',
        }),
      ]),
    );
  });

  it('persists session metrics entries for task usage visibility', () => {
    const specDir = mkdtempSync(join(tmpdir(), 'task-log-writer-'));
    tempDirs.push(specDir);

    const writer = new TaskLogWriter(specDir, '050-test-task');
    writer.startPhase('planning');
    writer.logMetrics({
      agentType: 'planner',
      sessionNumber: 1,
      stepsExecuted: 4,
      toolCallCount: 2,
      continuationCount: 1,
      promptTokens: 1200,
      completionTokens: 300,
      totalTokens: 1500,
      cumulativeTokens: 1500,
      budgetLimitTokens: 10000000,
    }, 'planning');
    writer.endPhase('planning', true);

    const logFile = join(specDir, 'task_logs.json');
    const logs = JSON.parse(readFileSync(logFile, 'utf-8')) as {
      phases: {
        planning: {
          entries: Array<{ type: string; metrics?: { totalTokens: number; budgetLimitTokens?: number } }>;
        };
      };
    };

    expect(logs.phases.planning.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'metrics',
          metrics: expect.objectContaining({
            totalTokens: 1500,
            budgetLimitTokens: 10000000,
          }),
        }),
      ]),
    );
  });
});
