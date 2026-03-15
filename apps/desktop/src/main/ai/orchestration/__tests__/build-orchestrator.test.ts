import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { BuildOrchestrator } from '../build-orchestrator';
import type { SessionRunConfig } from '../build-orchestrator';
import type { SessionResult } from '../../session/types';

function createSessionResult(
  outcome: SessionResult['outcome'],
  overrides: Partial<SessionResult> = {},
): SessionResult {
  return {
    outcome,
    stepsExecuted: 1,
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    messages: [],
    durationMs: 25,
    toolCallCount: 1,
    ...overrides,
  };
}

describe('BuildOrchestrator', () => {
  let specDir: string;
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), 'build-orchestrator-project-'));
    specDir = join(projectDir, '.auto-claude', 'specs', '001-feature');
    await mkdir(specDir, { recursive: true });

    await writeFile(
      join(specDir, 'implementation_plan.json'),
      JSON.stringify({
        feature: 'test feature',
        phases: [
          {
            id: 'phase-1',
            name: 'Implementation',
            subtasks: [
              { id: 'subtask-1', title: 'First subtask', description: 'Complete first subtask', status: 'pending', files_to_create: ['src/first.ts'] },
              { id: 'subtask-2', title: 'Second subtask', description: 'This one will get stuck', status: 'pending', files_to_create: ['src/second.ts'] },
            ],
          },
        ],
      }, null, 2),
    );
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it('fails the build when any subtask becomes stuck, even after partial progress', async () => {
    const runSession = vi.fn(async (config: SessionRunConfig) => {
      if (config.agentType !== 'coder') {
        return createSessionResult('completed');
      }

      if (config.subtaskId === 'subtask-1') {
        await mkdir(join(projectDir, 'src'), { recursive: true });
        await writeFile(join(projectDir, 'src', 'first.ts'), 'export const first = true;\n');
        return createSessionResult('completed');
      }

      if (config.subtaskId === 'subtask-2') {
        return createSessionResult('max_steps');
      }

      return createSessionResult('error', {
        error: { code: 'unexpected', message: 'unexpected subtask', retryable: false },
      });
    });

    const orchestrator = new BuildOrchestrator({
      specDir,
      projectDir,
      generatePrompt: vi.fn().mockResolvedValue('prompt'),
      runSession,
    });

    const outcome = await orchestrator.run();

    expect(outcome.success).toBe(false);
    expect(outcome.error).toContain('Subtasks stuck after max retries: subtask-2');
    expect(runSession).not.toHaveBeenCalledWith(
      expect.objectContaining({ agentType: 'qa_reviewer' }),
    );
  }, 15_000);

  it('classifies a replanning failure as a planning failure when the existing plan is unusable', async () => {
    await writeFile(
      join(specDir, 'implementation_plan.json'),
      JSON.stringify({
        feature: 'broken feature',
        phases: [],
      }, null, 2),
    );

    const orchestrator = new BuildOrchestrator({
      specDir,
      projectDir,
      generatePrompt: vi.fn().mockResolvedValue('prompt'),
      runSession: vi.fn().mockResolvedValue(createSessionResult('error', {
        error: { code: 'invalid_plan', message: 'planner failed', retryable: false },
      })),
    });

    const outcome = await orchestrator.run();

    expect(outcome.success).toBe(false);
    expect(outcome.planningCompleted).toBe(false);
    expect(outcome.codingCompleted).toBe(false);
    expect(outcome.error).toContain('planner failed');
  });

  it('reruns planning when an existing implementation plan has no subtasks', async () => {
    await writeFile(
      join(specDir, 'implementation_plan.json'),
      JSON.stringify({
        feature: 'empty feature',
        phases: [],
      }, null, 2),
    );

    const runSession = vi.fn(async (config: SessionRunConfig) => {
      if (config.agentType === 'planner') {
        await writeFile(
          join(specDir, 'implementation_plan.json'),
          JSON.stringify({
            feature: 'replanned feature',
            phases: [
              {
                id: 'phase-1',
                name: 'Implementation',
                subtasks: [
                  { id: 'subtask-1', description: 'Implement feature', status: 'pending', files_to_create: ['src/feature.ts'] },
                ],
              },
            ],
          }, null, 2),
        );
      } else if (config.agentType === 'coder') {
        await mkdir(join(projectDir, 'src'), { recursive: true });
        await writeFile(join(projectDir, 'src', 'feature.ts'), 'export const feature = true;\n');
      } else if (config.agentType === 'qa_reviewer') {
        await writeFile(join(specDir, 'qa_report.md'), 'Status: PASSED\n');
      }
      return createSessionResult('completed');
    });

    const orchestrator = new BuildOrchestrator({
      specDir,
      projectDir,
      generatePrompt: vi.fn().mockResolvedValue('prompt'),
      runSession,
    });

    const outcome = await orchestrator.run();

    expect(outcome.success).toBe(true);
    expect(runSession).toHaveBeenCalledWith(
      expect.objectContaining({ agentType: 'planner' }),
    );
    expect(runSession).toHaveBeenCalledWith(
      expect.objectContaining({ agentType: 'coder' }),
    );
  }, 15_000);

  it('stops coding when repeated completed sessions make no observable progress', async () => {
    await writeFile(
      join(specDir, 'implementation_plan.json'),
      JSON.stringify({
        feature: 'no-progress feature',
        phases: [
          {
            id: 'phase-1',
            name: 'Implementation',
            subtasks: [
              { id: 'subtask-1', title: 'No-op subtask', description: 'Does not change anything', status: 'pending' },
            ],
          },
        ],
      }, null, 2),
    );

    const runSession = vi.fn(async (config: SessionRunConfig) => {
      if (config.agentType === 'coder') {
        return createSessionResult('completed');
      }
      return createSessionResult('completed');
    });

    const orchestrator = new BuildOrchestrator({
      specDir,
      projectDir,
      generatePrompt: vi.fn().mockResolvedValue('prompt'),
      runSession,
    });

    const outcome = await orchestrator.run();

    expect(outcome.success).toBe(false);
    expect(outcome.error).toContain('Subtasks stuck after max retries: subtask-1');
    expect(runSession).not.toHaveBeenCalledWith(
      expect.objectContaining({ agentType: 'qa_reviewer' }),
    );
  }, 15_000);
});
