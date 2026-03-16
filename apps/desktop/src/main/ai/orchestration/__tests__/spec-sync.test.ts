import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { syncSpecArtifactsToSource } from '../spec-sync';

describe('syncSpecArtifactsToSource', () => {
  const cleanupDirs: string[] = [];

  afterEach(async () => {
    while (cleanupDirs.length > 0) {
      const dir = cleanupDirs.pop();
      if (dir) {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });

  it('syncs planner output from the worktree while preserving live status fields from the source plan', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'spec-sync-'));
    cleanupDirs.push(rootDir);

    const worktreeSpecDir = join(rootDir, 'worktree', '.auto-claude', 'specs', '052-feature');
    const sourceSpecDir = join(rootDir, 'project', '.auto-claude', 'specs', '052-feature');
    await mkdir(worktreeSpecDir, { recursive: true });
    await mkdir(sourceSpecDir, { recursive: true });

    await writeFile(
      join(worktreeSpecDir, 'implementation_plan.json'),
      JSON.stringify({
        feature: 'Turnstile verifier',
        workflow_type: 'feature',
        phases: [
          {
            id: '1',
            name: 'Implementation',
            subtasks: [
              { id: '1-1', title: 'Create verifier', description: 'Add the verifier module', status: 'pending' },
            ],
          },
        ],
      }, null, 2),
    );

    await writeFile(
      join(sourceSpecDir, 'implementation_plan.json'),
      JSON.stringify({
        created_at: '2026-03-16T14:01:23.999Z',
        phases: [],
        status: 'in_progress',
        planStatus: 'in_progress',
        xstateState: 'planning',
        executionPhase: 'planning',
        lastEvent: {
          sequence: 20,
          type: 'CODING_STARTED',
        },
      }, null, 2),
    );

    await writeFile(join(worktreeSpecDir, 'qa_report.md'), 'Status: PASSED\n');

    const synced = await syncSpecArtifactsToSource(worktreeSpecDir, sourceSpecDir);
    expect(synced).toBe(true);

    const syncedPlan = JSON.parse(await readFile(join(sourceSpecDir, 'implementation_plan.json'), 'utf-8')) as Record<string, unknown>;
    expect(syncedPlan.feature).toBe('Turnstile verifier');
    expect(syncedPlan.workflow_type).toBe('feature');
    expect((syncedPlan.phases as unknown[])).toHaveLength(1);
    expect(syncedPlan.status).toBe('in_progress');
    expect(syncedPlan.xstateState).toBe('planning');
    expect(syncedPlan.executionPhase).toBe('planning');
    expect((syncedPlan.lastEvent as { sequence: number }).sequence).toBe(20);
    await expect(readFile(join(sourceSpecDir, 'qa_report.md'), 'utf-8')).resolves.toBe('Status: PASSED\n');
  });
});
