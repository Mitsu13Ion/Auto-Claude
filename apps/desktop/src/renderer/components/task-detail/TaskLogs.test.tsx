import { describe, expect, it, vi } from 'vitest';

vi.mock('@shared/utils/model-display', () => ({
  getProviderModelLabel: (model: string) => model,
}));

import type { Task, TaskLogs as TaskLogsType } from '../../../shared/types';
import {
  getLatestTaskErrorMessage,
  getPhaseErrorMessages,
  getTaskRunSummary,
  getUnmatchedLegacyErrorMessages,
} from './TaskLogs';

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    specId: '050-test-task',
    title: 'Test task',
    description: '',
    status: 'human_review',
    priority: 'medium',
    createdAt: new Date(),
    updatedAt: new Date(),
    subtasks: [],
    dependencies: [],
    logs: [],
    projectId: 'project-1',
    ...overrides,
  } as Task;
}

function createPhaseLogs(): TaskLogsType {
  return {
    spec_id: '050-test-task',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    phases: {
      planning: { phase: 'planning', status: 'failed', started_at: null, completed_at: null, entries: [] },
      coding: { phase: 'coding', status: 'pending', started_at: null, completed_at: null, entries: [] },
      validation: { phase: 'validation', status: 'pending', started_at: null, completed_at: null, entries: [] },
    },
  };
}

describe('TaskLogs error helpers', () => {
  it('prefers persisted phase errors over legacy renderer-only errors', () => {
    const task = createTask({
      logs: ['[ERROR] Legacy renderer error'],
    });
    const phaseLogs = createPhaseLogs();
    phaseLogs.phases.planning.entries.push({
      timestamp: new Date().toISOString(),
      type: 'error',
      content: 'Persisted planning failure',
      phase: 'planning',
    });

    expect(getPhaseErrorMessages(phaseLogs)).toEqual(['Persisted planning failure']);
    expect(getLatestTaskErrorMessage(task, phaseLogs)).toBe('Persisted planning failure');
  });

  it('keeps unmatched legacy errors visible when phase logs exist', () => {
    const task = createTask({
      logs: [
        '[ERROR] Persisted planning failure',
        '[ERROR] Worker crashed before phase log flush',
      ],
    });
    const phaseLogs = createPhaseLogs();
    phaseLogs.phases.planning.entries.push({
      timestamp: new Date().toISOString(),
      type: 'error',
      content: 'Persisted planning failure',
      phase: 'planning',
    });

    expect(getUnmatchedLegacyErrorMessages(task, phaseLogs)).toEqual([
      'Worker crashed before phase log flush',
    ]);
  });

  it('aggregates persisted session metrics for the task usage summary', () => {
    const phaseLogs = createPhaseLogs();
    phaseLogs.phases.planning.entries.push({
      timestamp: new Date().toISOString(),
      type: 'metrics',
      content: 'Session 1 (planner)',
      phase: 'planning',
      metrics: {
        agentType: 'planner',
        sessionNumber: 1,
        stepsExecuted: 4,
        toolCallCount: 2,
        continuationCount: 0,
        promptTokens: 1200,
        completionTokens: 300,
        totalTokens: 1500,
        budgetLimitTokens: 900000,
      },
    });
    phaseLogs.phases.coding.entries.push({
      timestamp: new Date().toISOString(),
      type: 'metrics',
      content: 'Session 2 (coder)',
      phase: 'coding',
      metrics: {
        agentType: 'coder',
        sessionNumber: 2,
        stepsExecuted: 8,
        toolCallCount: 4,
        continuationCount: 1,
        promptTokens: 4000,
        completionTokens: 1000,
        totalTokens: 5000,
        budgetLimitTokens: 900000,
      },
    });

    expect(getTaskRunSummary(phaseLogs)).toEqual({
      sessionCount: 2,
      stepCount: 12,
      toolCallCount: 6,
      continuationCount: 1,
      promptTokens: 5200,
      completionTokens: 1300,
      totalTokens: 6500,
      budgetLimitTokens: 900000,
    });
  });
});
