import { describe, expect, it } from 'vitest';

import { TaskRunGuard } from '../task-run-guard';
import type { SessionResult } from '../../session/types';

function createSessionResult(
  totalTokens: number,
  overrides: Partial<SessionResult> = {},
): SessionResult {
  return {
    outcome: 'completed',
    stepsExecuted: 4,
    usage: {
      promptTokens: Math.floor(totalTokens * 0.8),
      completionTokens: Math.floor(totalTokens * 0.2),
      totalTokens,
    },
    messages: [],
    durationMs: 100,
    toolCallCount: 2,
    continuationCount: 0,
    ...overrides,
  };
}

describe('TaskRunGuard', () => {
  it('tracks cumulative usage and stops when the task token budget is exceeded', () => {
    const guard = new TaskRunGuard(null, {
      maxTotalTokens: 1_000,
      maxSessions: 10,
      maxContinuations: 5,
    });

    expect(guard.canStartSession()).toBeNull();
    expect(guard.recordSession('planner', 'planning', 1, createSessionResult(450))).toBeNull();
    expect(guard.recordSession('coder', 'coding', 2, createSessionResult(600))).toContain('Task execution budget exceeded');

    expect(guard.getSummary()).toMatchObject({
      sessions: 2,
      stepsExecuted: 8,
      toolCallCount: 4,
      continuationCount: 0,
      usage: expect.objectContaining({
        totalTokens: 1050,
      }),
    });
  });

  it('counts auxiliary AI usage against the same task budget', () => {
    const guard = new TaskRunGuard(null, {
      maxTotalTokens: 1_000,
      maxSessions: 10,
      maxContinuations: 5,
    });

    expect(guard.recordSession('planner', 'planning', 1, createSessionResult(600))).toBeNull();
    expect(
      guard.recordAuxiliaryUsage('planning', 'json_repair', {
        promptTokens: 250,
        completionTokens: 200,
        totalTokens: 450,
      }),
    ).toContain('Task execution budget exceeded');

    expect(guard.getSummary().usage.totalTokens).toBe(1050);
  });
});
