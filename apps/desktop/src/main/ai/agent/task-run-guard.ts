import type { TaskRunMetrics } from '../../../shared/types/task';
import type { AgentType } from '../config/agent-configs';
import type { Phase } from '../config/types';
import { TaskLogWriter } from '../logging/task-log-writer';
import type { SessionResult, TokenUsage } from '../session/types';

export interface TaskRunBudget {
  maxTotalTokens: number;
  maxSessions: number;
  maxContinuations: number;
}

export interface TaskRunSummary {
  sessions: number;
  stepsExecuted: number;
  toolCallCount: number;
  continuationCount: number;
  usage: TokenUsage;
  budget: TaskRunBudget;
}

export const DEFAULT_TASK_RUN_BUDGET: TaskRunBudget = {
  maxTotalTokens: 900_000,
  maxSessions: 24,
  maxContinuations: 8,
};

export class TaskRunGuard {
  private readonly usage: TokenUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };

  private sessions = 0;
  private stepsExecuted = 0;
  private toolCallCount = 0;
  private continuationCount = 0;

  constructor(
    private readonly logWriter?: TaskLogWriter | null,
    private readonly budget: TaskRunBudget = DEFAULT_TASK_RUN_BUDGET,
  ) {}

  canStartSession(): string | null {
    return this.getBudgetExceededMessage();
  }

  recordSession(
    agentType: AgentType,
    phase: Phase,
    sessionNumber: number,
    result: SessionResult,
  ): string | null {
    this.sessions += 1;
    this.stepsExecuted += result.stepsExecuted;
    this.toolCallCount += result.toolCallCount;
    this.continuationCount += result.continuationCount ?? 0;
    addUsage(this.usage, result.cumulativeUsage ?? result.usage);

    const metrics: TaskRunMetrics = {
      agentType,
      sessionNumber,
      stepsExecuted: result.stepsExecuted,
      toolCallCount: result.toolCallCount,
      continuationCount: result.continuationCount ?? 0,
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
      totalTokens: result.usage.totalTokens,
      cumulativeSessions: this.sessions,
      cumulativeSteps: this.stepsExecuted,
      cumulativeToolCalls: this.toolCallCount,
      cumulativeContinuations: this.continuationCount,
      cumulativeTokens: this.usage.totalTokens,
      budgetLimitTokens: this.budget.maxTotalTokens,
    };

    this.logWriter?.logMetrics(metrics, phase);
    return this.getBudgetExceededMessage();
  }

  recordAuxiliaryUsage(
    phase: Phase,
    label: string,
    usage: TokenUsage | null | undefined,
  ): string | null {
    if (!usage || usage.totalTokens <= 0) {
      return null;
    }

    addUsage(this.usage, usage);
    this.logWriter?.logText(
      `Auxiliary AI (${label}) | ${usage.totalTokens.toLocaleString()} tokens`,
      phase,
      'metrics',
    );
    return this.getBudgetExceededMessage();
  }

  getSummary(): TaskRunSummary {
    return {
      sessions: this.sessions,
      stepsExecuted: this.stepsExecuted,
      toolCallCount: this.toolCallCount,
      continuationCount: this.continuationCount,
      usage: { ...this.usage },
      budget: this.budget,
    };
  }

  private getBudgetExceededMessage(): string | null {
    if (this.usage.totalTokens >= this.budget.maxTotalTokens) {
      return [
        'Task execution budget exceeded',
        `${formatNumber(this.usage.totalTokens)} tokens used`,
        `${this.sessions} sessions`,
        `${this.continuationCount} continuations`,
        `(limit ${formatNumber(this.budget.maxTotalTokens)} tokens)`,
      ].join(' ');
    }

    if (this.sessions >= this.budget.maxSessions) {
      return `Task execution budget exceeded: ${this.sessions} sessions used (limit ${this.budget.maxSessions})`;
    }

    if (this.continuationCount >= this.budget.maxContinuations) {
      return `Task execution budget exceeded: ${this.continuationCount} context-window continuations used (limit ${this.budget.maxContinuations})`;
    }

    return null;
  }
}

function addUsage(target: TokenUsage, source: TokenUsage): void {
  target.promptTokens += source.promptTokens;
  target.completionTokens += source.completionTokens;
  target.totalTokens += source.totalTokens;

  if (source.thinkingTokens !== undefined) {
    target.thinkingTokens = (target.thinkingTokens ?? 0) + source.thinkingTokens;
  }
  if (source.cacheReadTokens !== undefined) {
    target.cacheReadTokens = (target.cacheReadTokens ?? 0) + source.cacheReadTokens;
  }
  if (source.cacheCreationTokens !== undefined) {
    target.cacheCreationTokens = (target.cacheCreationTokens ?? 0) + source.cacheCreationTokens;
  }
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}
