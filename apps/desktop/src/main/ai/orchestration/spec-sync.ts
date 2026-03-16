import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { writeFileWithRetry } from '../../utils/atomic-file';
import { safeParseJson } from '../../utils/json-repair';

const LIVE_PLAN_FIELDS = [
  'status',
  'planStatus',
  'reviewReason',
  'xstateState',
  'executionPhase',
] as const;

const OPTIONAL_SPEC_ARTIFACTS = [
  'qa_report.md',
  'QA_FIX_REQUEST.md',
] as const;

type PlanRecord = Record<string, unknown>;

function pickNewerLastEvent(sourceLastEvent: unknown, worktreeLastEvent: unknown): unknown {
  const sourceSequence = typeof (sourceLastEvent as { sequence?: unknown } | undefined)?.sequence === 'number'
    ? (sourceLastEvent as { sequence: number }).sequence
    : -1;
  const worktreeSequence = typeof (worktreeLastEvent as { sequence?: unknown } | undefined)?.sequence === 'number'
    ? (worktreeLastEvent as { sequence: number }).sequence
    : -1;

  return sourceSequence >= worktreeSequence ? sourceLastEvent : worktreeLastEvent;
}

export async function syncSpecArtifactsToSource(specDir: string, sourceSpecDir: string): Promise<boolean> {
  const worktreePlanPath = join(specDir, 'implementation_plan.json');
  if (!existsSync(worktreePlanPath)) {
    return false;
  }

  try {
    await mkdir(sourceSpecDir, { recursive: true });

    const worktreeRaw = await readFile(worktreePlanPath, 'utf-8');
    const worktreePlan = safeParseJson<PlanRecord>(worktreeRaw);
    if (!worktreePlan) {
      return false;
    }

    const sourcePlanPath = join(sourceSpecDir, 'implementation_plan.json');
    let sourcePlan: PlanRecord = {};
    if (existsSync(sourcePlanPath)) {
      const sourceRaw = await readFile(sourcePlanPath, 'utf-8');
      sourcePlan = safeParseJson<PlanRecord>(sourceRaw) ?? {};
    }

    const mergedPlan: PlanRecord = {
      ...worktreePlan,
      created_at: sourcePlan.created_at ?? worktreePlan.created_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    for (const field of LIVE_PLAN_FIELDS) {
      if (sourcePlan[field] !== undefined) {
        mergedPlan[field] = sourcePlan[field];
      }
    }

    const lastEvent = pickNewerLastEvent(sourcePlan.lastEvent, worktreePlan.lastEvent);
    if (lastEvent !== undefined) {
      mergedPlan.lastEvent = lastEvent;
    }

    await writeFileWithRetry(sourcePlanPath, JSON.stringify(mergedPlan, null, 2));

    for (const artifact of OPTIONAL_SPEC_ARTIFACTS) {
      const sourceArtifactPath = join(sourceSpecDir, artifact);
      const worktreeArtifactPath = join(specDir, artifact);
      if (existsSync(worktreeArtifactPath)) {
        await copyFile(worktreeArtifactPath, sourceArtifactPath);
      }
    }

    return true;
  } catch {
    return false;
  }
}
