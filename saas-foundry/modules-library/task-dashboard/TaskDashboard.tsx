import { useCallback, useEffect, useState } from 'react';
import { hasScopes, useCoreService } from '@foundry/engine-core/ui';
import type { SecurityScope } from '@foundry/shared';

export type TaskStatus = 'todo' | 'in-progress' | 'done';

export interface Task {
	readonly id: string;
	readonly title: string;
	readonly status: TaskStatus;
	readonly dueDate: string; // ISO-8601
}

/** Must mirror `permissions` in manifest.json — the PluginRegistry gates the load, this gates the render. */
const REQUIRED_SCOPES: readonly SecurityScope[] = ['read:tasks', 'write:tasks'];

const NEXT_STATUS: Readonly<Record<TaskStatus, TaskStatus>> = {
	'todo': 'in-progress',
	'in-progress': 'done',
	'done': 'todo'
};

function AccessDenied(): React.JSX.Element {
	return (
		<div role="alert" className="plugin-access-denied">
			<h2>Acesso negado</h2>
			<p>Você não possui as permissões necessárias para usar o Task Dashboard.</p>
		</div>
	);
}

/**
 * Entry component. All data flows through the Core's ApiService obtained
 * via `useCoreService()` — this file has no DB driver, connection string,
 * fetch or storage handle, and cannot be mounted outside the validated
 * plugin host (the context is only provided after PluginRegistry approval).
 */
export default function TaskDashboard(): React.JSX.Element {
	const core = useCoreService();
	if (!hasScopes(core, REQUIRED_SCOPES)) {
		return <AccessDenied />;
	}
	return <AuthorizedDashboard />;
}

function AuthorizedDashboard(): React.JSX.Element {
	const { api } = useCoreService();
	const [tasks, setTasks] = useState<readonly Task[] | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		api.get<readonly Task[]>('tasks')
			.then(fetched => { if (!cancelled) { setTasks(fetched); } })
			.catch((err: unknown) => { if (!cancelled) { setError((err as Error).message); } });
		return () => { cancelled = true; };
	}, [api]);

	const advanceStatus = useCallback(async (task: Task) => {
		const updated: Task = { ...task, status: NEXT_STATUS[task.status] };
		await api.put<Task>(`tasks/${task.id}`, updated);
		setTasks(current => (current ?? []).map(t => (t.id === task.id ? updated : t)));
	}, [api]);

	if (error !== null) {
		return <div role="alert">Erro ao carregar tarefas: {error}</div>;
	}
	if (tasks === null) {
		return <p>Carregando tarefas…</p>;
	}
	return (
		<section className="task-dashboard">
			<h1>Task Dashboard</h1>
			{tasks.length === 0 ? (
				<p>Nenhuma tarefa.</p>
			) : (
				<ul>
					{tasks.map(task => (
						<li key={task.id}>
							<span>{task.title}</span>
							<time dateTime={task.dueDate}>{new Date(task.dueDate).toLocaleDateString()}</time>
							<button type="button" onClick={() => void advanceStatus(task)}>
								{task.status}
							</button>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}

/** Registry entry contract: the only sanctioned way to instantiate the component. */
export function createPlugin(): typeof TaskDashboard {
	return TaskDashboard;
}
