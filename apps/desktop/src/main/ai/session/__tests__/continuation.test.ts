import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { SessionConfig, SessionResult } from '../types';

const mockRunAgentSession = vi.fn();
const mockGenerateText = vi.fn();

vi.mock('../runner', () => ({
  runAgentSession: (...args: unknown[]) => mockRunAgentSession(...args),
}));

vi.mock('ai', () => ({
  generateText: (...args: unknown[]) => mockGenerateText(...args),
}));

import { runContinuableSession } from '../continuation';

function createConfig(overrides: Partial<SessionConfig> = {}): SessionConfig {
  return {
    agentType: 'coder',
    model: {} as SessionConfig['model'],
    systemPrompt: 'test',
    initialMessages: [{ role: 'user', content: 'hello' }],
    toolContext: {} as SessionConfig['toolContext'],
    maxSteps: 10,
    specDir: '/specs/001',
    projectDir: '/project',
    ...overrides,
  };
}

function createResult(overrides: Partial<SessionResult> = {}): SessionResult {
  return {
    outcome: 'completed',
    stepsExecuted: 1,
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    messages: [{ role: 'assistant', content: 'done' }],
    durationMs: 100,
    toolCallCount: 1,
    ...overrides,
  };
}

describe('runContinuableSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('preserves context_window outcome when max continuations is exhausted', async () => {
    mockRunAgentSession.mockResolvedValue(
      createResult({ outcome: 'context_window' }),
    );

    const result = await runContinuableSession(
      createConfig(),
      {},
      { contextWindowLimit: 200_000, maxContinuations: 0 },
    );

    expect(result.outcome).toBe('context_window');
    expect(result.continuationCount).toBe(0);
    expect(result.stepsExecuted).toBe(1);
  });

  it('continues once and returns completed when a later session converges', async () => {
    mockRunAgentSession
      .mockResolvedValueOnce(
        createResult({
          outcome: 'context_window',
          messages: [
            { role: 'user', content: 'task' },
            { role: 'assistant', content: 'partial progress' },
          ],
        }),
      )
      .mockResolvedValueOnce(
        createResult({
          outcome: 'completed',
          messages: [{ role: 'assistant', content: 'final answer' }],
        }),
      );

    mockGenerateText.mockResolvedValue({ text: 'summary of prior work' });

    const result = await runContinuableSession(
      createConfig(),
      {},
      { contextWindowLimit: 200_000, maxContinuations: 1 },
    );

    expect(result.outcome).toBe('completed');
    expect(result.continuationCount).toBe(1);
    expect(result.stepsExecuted).toBe(2);
    expect(mockGenerateText).toHaveBeenCalledTimes(1);
  });
});
