export class McpSessionManager {
  // Map of SSE sessionId to Task ID
  private sessionToTask: Map<string, string> = new Map();

  bindTaskToSession(sessionId: string, taskId: string): void {
    this.sessionToTask.set(sessionId, taskId);
  }

  getTaskForSession(sessionId: string): string | undefined {
    return this.sessionToTask.get(sessionId);
  }

  endSession(sessionId: string): void {
    this.sessionToTask.delete(sessionId);
  }

  getActiveSessionCount(): number {
    return this.sessionToTask.size;
  }

  getActiveSessions(): string[] {
    return Array.from(this.sessionToTask.keys());
  }
}

export const mcpSessionManager = new McpSessionManager();
