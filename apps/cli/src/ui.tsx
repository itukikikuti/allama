import { useEffect, useState } from 'react';
import { Box, Text, useApp } from 'ink';

import type { Task, TaskEvent, TaskStore } from '@allama/core';

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'awaiting_decision']);

export interface DashboardProps {
  store: TaskStore;
  taskId: string;
}

export function Dashboard({ store, taskId }: DashboardProps) {
  const [task, setTask] = useState<Task>(() => store.getTask(taskId));
  const [events, setEvents] = useState<TaskEvent[]>(() => store.listEvents(taskId));
  const { exit } = useApp();

  useEffect(() => {
    const timer = setInterval(() => {
      const nextTask = store.getTask(taskId);
      setTask(nextTask);
      setEvents(store.listEvents(taskId));
      if (TERMINAL_STATUSES.has(nextTask.status)) {
        setTimeout(() => exit(), 150).unref();
      }
    }, 250);
    return () => clearInterval(timer);
  }, [exit, store, taskId]);

  const recentEvents = events.slice(-8);
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold color="cyan">
        allama — AI作業の実行状況
      </Text>
      <Text>
        Task: {task.id} / Status: <Text color="yellow">{task.status}</Text>
      </Text>
      {task.worktreePath ? <Text dimColor>Worktree: {task.worktreePath}</Text> : null}
      <Box marginTop={1} flexDirection="column">
        {recentEvents.map((event) => (
          <Text key={event.id}>
            <Text dimColor>{new Date(event.createdAt).toLocaleTimeString()}</Text>{' '}
            <Text color={event.kind === 'decision_required' ? 'red' : 'green'}>●</Text>{' '}
            {event.message}
          </Text>
        ))}
      </Box>
    </Box>
  );
}

export function ContractCard({ task }: { task: Task }) {
  if (!task.contract) return null;
  const contract = task.contract;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text bold>作業契約</Text>
      <Text>目的: {contract.goal}</Text>
      <Text>完了条件: {contract.completionCriteria.join(' / ')}</Text>
      <Text>変更範囲: {contract.allowedPaths.join(', ')}</Text>
      <Text>対象外: {contract.outOfScope.join(', ') || 'なし'}</Text>
      <Text>検証: {contract.validationCommands.join(' / ') || 'git diff --check'}</Text>
    </Box>
  );
}
