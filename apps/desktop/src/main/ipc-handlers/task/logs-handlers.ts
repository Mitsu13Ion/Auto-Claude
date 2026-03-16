import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS, getSpecsDir } from '../../../shared/constants';
import type { IPCResult, TaskLogs, TaskLogPhase, TaskLogStreamChunk, TaskPhaseLog } from '../../../shared/types';
import path from 'path';
import { projectStore } from '../../project-store';
import { taskLogService } from '../../task-log-service';
import { isValidTaskId } from '../../utils/spec-path-helpers';
import { debugLog } from '../../../shared/utils/debug-logger';
import { ensureAbsolutePath } from '../../utils/path-helpers';

const DEFAULT_RECENT_LOG_ENTRY_LIMIT = 200;
const DEFAULT_PHASE_LOG_PAGE_SIZE = 200;

function buildPhaseWindow(phaseLog: TaskPhaseLog, startIndex: number, endIndex: number): TaskPhaseLog {
  const totalEntries = phaseLog.entries.length;
  const safeStartIndex = Math.max(0, Math.min(startIndex, totalEntries));
  const safeEndIndex = Math.max(safeStartIndex, Math.min(endIndex, totalEntries));

  return {
    ...phaseLog,
    entries: phaseLog.entries.slice(safeStartIndex, safeEndIndex),
    totalEntries,
    visibleStartIndex: safeStartIndex,
    visibleEndIndex: safeEndIndex,
    hasOlderEntries: safeStartIndex > 0,
  };
}

function getPhaseWindow(
  phaseLog: TaskPhaseLog,
  beforeIndex?: number,
  limit = DEFAULT_PHASE_LOG_PAGE_SIZE
): TaskPhaseLog {
  const totalEntries = phaseLog.entries.length;
  const safeLimit = Math.max(1, limit);
  const endIndex = beforeIndex === undefined
    ? totalEntries
    : Math.max(0, Math.min(beforeIndex, totalEntries));
  const startIndex = Math.max(0, endIndex - safeLimit);

  return buildPhaseWindow(phaseLog, startIndex, endIndex);
}

function getRecentPhaseWindow(phaseLog: TaskPhaseLog, limit = DEFAULT_RECENT_LOG_ENTRY_LIMIT): TaskPhaseLog {
  const totalEntries = phaseLog.entries.length;
  if (totalEntries <= limit) {
    return phaseLog;
  }

  return buildPhaseWindow(phaseLog, totalEntries - limit, totalEntries);
}

function sliceTaskLogs(logs: TaskLogs, limit = DEFAULT_RECENT_LOG_ENTRY_LIMIT): TaskLogs {
  return {
    ...logs,
    phases: {
      planning: getRecentPhaseWindow(logs.phases.planning, limit),
      coding: getRecentPhaseWindow(logs.phases.coding, limit),
      validation: getRecentPhaseWindow(logs.phases.validation, limit),
    },
  };
}

/**
 * Register task logs handlers
 */
export function registerTaskLogsHandlers(getMainWindow: () => BrowserWindow | null): void {
  /**
   * Get task logs from spec directory
   * Returns logs organized by phase (planning, coding, validation)
   */
  ipcMain.handle(
    IPC_CHANNELS.TASK_LOGS_GET,
    async (_, projectId: string, specId: string): Promise<IPCResult<TaskLogs | null>> => {
      try {
        if (!isValidTaskId(specId)) {
          return { success: false, error: 'Invalid spec ID' };
        }

        const project = projectStore.getProject(projectId);
        if (!project) {
          console.error('[TASK_LOGS_GET] Project not found:', projectId);
          return { success: false, error: 'Project not found' };
        }

        // Defense-in-depth: project.path is normally absolute from ProjectStore,
        // but we guard here against edge cases (e.g., manually edited store file)
        const absoluteProjectPath = ensureAbsolutePath(project.path);
        const specsRelPath = getSpecsDir(project.autoBuildPath);
        const specDir = path.join(absoluteProjectPath, specsRelPath, specId);

        debugLog('[TASK_LOGS_GET] Path resolution:', {
          projectId,
          specId,
          absoluteProjectPath,
          specsRelPath,
          specDir,
        });

        // Don't fail if specDir doesn't exist yet — the agent may not have created it.
        // taskLogService.loadLogs() handles missing directories gracefully (returns null).
        const logs = taskLogService.loadLogs(specDir, absoluteProjectPath, specsRelPath, specId);

        debugLog('[TASK_LOGS_GET] Logs loaded:', {
          specId,
          hasLogs: !!logs,
          phaseCounts: logs ? {
            planning: logs.phases.planning?.entries?.length || 0,
            coding: logs.phases.coding?.entries?.length || 0,
            validation: logs.phases.validation?.entries?.length || 0
          } : null
        });

        return { success: true, data: logs ? sliceTaskLogs(logs) : null };
      } catch (error) {
        console.error('[TASK_LOGS_GET] Failed to get task logs:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get task logs'
        };
      }
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.TASK_LOGS_GET_PHASE,
    async (
      _,
      projectId: string,
      specId: string,
      phase: TaskLogPhase,
      beforeIndex?: number,
      limit?: number
    ): Promise<IPCResult<TaskPhaseLog | null>> => {
      try {
        if (!isValidTaskId(specId)) {
          return { success: false, error: 'Invalid spec ID' };
        }

        if (!['planning', 'coding', 'validation'].includes(phase)) {
          return { success: false, error: 'Invalid log phase' };
        }

        const project = projectStore.getProject(projectId);
        if (!project) {
          console.error('[TASK_LOGS_GET_PHASE] Project not found:', projectId);
          return { success: false, error: 'Project not found' };
        }

        const absoluteProjectPath = ensureAbsolutePath(project.path);
        const specsRelPath = getSpecsDir(project.autoBuildPath);
        const specDir = path.join(absoluteProjectPath, specsRelPath, specId);
        const logs = taskLogService.loadLogs(specDir, absoluteProjectPath, specsRelPath, specId);

        if (!logs) {
          return { success: true, data: null };
        }

        return {
          success: true,
          data: getPhaseWindow(logs.phases[phase], beforeIndex, limit),
        };
      } catch (error) {
        console.error('[TASK_LOGS_GET_PHASE] Failed to get task phase logs:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to get task phase logs'
        };
      }
    }
  );

  /**
   * Start watching a spec for log changes
   */
  ipcMain.handle(
    IPC_CHANNELS.TASK_LOGS_WATCH,
    async (_, projectId: string, specId: string): Promise<IPCResult> => {
      try {
        if (!isValidTaskId(specId)) {
          return { success: false, error: 'Invalid spec ID' };
        }

        const project = projectStore.getProject(projectId);
        if (!project) {
          console.error('[TASK_LOGS_WATCH] Project not found:', projectId);
          return { success: false, error: 'Project not found' };
        }

        const absoluteProjectPath = ensureAbsolutePath(project.path);
        const specsRelPath = getSpecsDir(project.autoBuildPath);
        const specDir = path.join(absoluteProjectPath, specsRelPath, specId);

        debugLog('[TASK_LOGS_WATCH] Starting watch:', {
          projectId,
          specId,
          absoluteProjectPath,
          specDir,
        });

        // Start watching even if specDir doesn't exist yet — the poll loop
        // in TaskLogService handles missing files gracefully and will pick up
        // task_logs.json once the agent creates it during execution.
        taskLogService.startWatching(specId, specDir, absoluteProjectPath, specsRelPath);
        return { success: true };
      } catch (error) {
        console.error('[TASK_LOGS_WATCH] Failed to start watching task logs:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to start watching'
        };
      }
    }
  );

  /**
   * Stop watching a spec for log changes
   */
  ipcMain.handle(
    IPC_CHANNELS.TASK_LOGS_UNWATCH,
    async (_, specId: string): Promise<IPCResult> => {
      try {
        if (!isValidTaskId(specId)) {
          return { success: false, error: 'Invalid spec ID' };
        }

        taskLogService.stopWatching(specId);
        return { success: true };
      } catch (error) {
        console.error('Failed to stop watching task logs:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to stop watching'
        };
      }
    }
  );

  /**
   * Setup task log service event forwarding to renderer
   */
  taskLogService.on('logs-changed', (specId: string, logs: TaskLogs) => {
    const mainWindow = getMainWindow();
    if (mainWindow) {
      mainWindow.webContents.send(IPC_CHANNELS.TASK_LOGS_CHANGED, specId, sliceTaskLogs(logs));
    }
  });

  taskLogService.on('stream-chunk', (specId: string, chunk: TaskLogStreamChunk) => {
    const mainWindow = getMainWindow();
    if (mainWindow) {
      mainWindow.webContents.send(IPC_CHANNELS.TASK_LOGS_STREAM, specId, chunk);
    }
  });

  taskLogService.on('watch-error', (specId: string, error: string) => {
    const mainWindow = getMainWindow();
    if (mainWindow) {
      mainWindow.webContents.send(IPC_CHANNELS.TASK_ERROR, specId, error);
    }
  });
}
