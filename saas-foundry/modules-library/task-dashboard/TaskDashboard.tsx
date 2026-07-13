import { useCallback, useEffect, useState } from 'react';
import { EmptyState, LoadingSkeleton, hasScopes, useCoreService, useToast } from '@foundry/engine-core/ui';
import type { SecurityScope } from '@foundry/shared';
import { ArrowRight, CalendarDays, ClipboardList, Plus, ShieldAlert, Trash2, TriangleAlert } from 'lucide-react';

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

const STATUS_LABELS: Readonly<Record<TaskStatus, string>> = {
	'todo': 'A fazer',
	'in-progress': 'Em andamento',
	'done': 'Concluída'
};

const STATUS_STYLES: Readonly<Record<TaskStatus, string>> = {
	'todo': 'bg-gray-100 text-gray-600 hover:bg-gray-200',
	'in-progress': 'bg-amber-100 text-amber-700 hover:bg-amber-200',
	'done': 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
};

function AccessDenied(): React.JSX.Element {
	return (
		<div role="alert" className="plugin-access-denied rounded-2xl bg-white p-10 text-center shadow-sm">
			<span className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-red-500">
				<ShieldAlert className="h-6 w-6" aria-hidden />
			</span>
			<h2 className="text-xl font-semibold tracking-tight text-gray-900">Acesso negado</h2>
			<p className="mt-2 text-sm text-gray-500">
				Você não possui as permissões necessárias para usar o Task Dashboard.
			</p>
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
	const toast = useToast();
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

	const createTask = useCallback(async () => {
		const task: Task = {
			id: crypto.randomUUID(),
			title: 'Nova tarefa',
			status: 'todo',
			dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
		};
		try {
			await api.put<Task>(`tasks/${task.id}`, task);
			setTasks(current => [...(current ?? []), task]);
			toast.success('Tarefa adicionada com sucesso!');
		} catch {
			toast.error('Não foi possível adicionar a tarefa.');
		}
	}, [api, toast]);

	const removeTask = useCallback(async (task: Task) => {
		try {
			await api.delete(`tasks/${task.id}`);
			setTasks(current => (current ?? []).filter(t => t.id !== task.id));
			toast.success('Tarefa excluída.');
		} catch {
			toast.error('Não foi possível excluir a tarefa.');
		}
	}, [api, toast]);

	if (error !== null) {
		return (
			<div role="alert" className="flex items-center gap-3 rounded-2xl bg-white p-6 text-sm text-red-600 shadow-sm">
				<TriangleAlert className="h-5 w-5 shrink-0" aria-hidden />
				Erro ao carregar tarefas: {error}
			</div>
		);
	}

	if (tasks === null) {
		return (
			<section className="rounded-2xl bg-white p-6 shadow-sm">
				<LoadingSkeleton rows={3} />
			</section>
		);
	}

	return (
		<section className="task-dashboard rounded-2xl bg-white p-6 shadow-sm">
			<header className="mb-6 flex items-start justify-between gap-4">
				<div>
					<h1 className="text-lg font-semibold tracking-tight text-gray-900">Task Dashboard</h1>
					<p className="mt-1 text-sm text-gray-500">Acompanhe as tarefas do seu namespace.</p>
				</div>
				<button
					type="button"
					onClick={() => void createTask()}
					className="flex shrink-0 items-center gap-2 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:scale-105 hover:shadow-md"
				>
					<Plus className="h-4 w-4" aria-hidden />
					Nova tarefa
				</button>
			</header>

			{tasks.length === 0 ? (
				<EmptyState
					icon={ClipboardList}
					title="Sua lista está limpa."
					description="Comece adicionando uma nova tarefa."
					actionLabel="Adicionar tarefa"
					onAction={() => void createTask()}
				/>
			) : (
				<ul className="space-y-3">
					{tasks.map(task => (
						<li
							key={task.id}
							className="flex items-center gap-4 rounded-xl border border-gray-100 bg-white p-4 shadow-sm transition-all hover:shadow-md"
						>
							<div className="min-w-0 flex-1">
								<span className="block truncate text-sm font-medium text-gray-900">{task.title}</span>
								<time
									dateTime={task.dueDate}
									className="mt-1 flex items-center gap-1.5 text-xs text-gray-500"
								>
									<CalendarDays className="h-3.5 w-3.5" aria-hidden />
									{new Date(task.dueDate).toLocaleDateString()}
								</time>
							</div>
							<button
								type="button"
								onClick={() => void advanceStatus(task)}
								title="Avançar status"
								className={`group flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-all hover:scale-105 ${STATUS_STYLES[task.status]}`}
							>
								{STATUS_LABELS[task.status]}
								<ArrowRight className="h-3.5 w-3.5 opacity-0 transition-all group-hover:opacity-100" aria-hidden />
							</button>
							<button
								type="button"
								onClick={() => void removeTask(task)}
								title="Excluir tarefa"
								aria-label={`Excluir ${task.title}`}
								className="rounded-lg p-2 text-gray-300 transition-all hover:scale-105 hover:bg-red-50 hover:text-red-500"
							>
								<Trash2 className="h-4 w-4" aria-hidden />
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
