import type { MouseEvent, ReactElement, ReactNode } from 'react';
import type { PluginRegistry } from '@foundry/engine-core/ui';

export interface MainLayoutProps {
	readonly registry: PluginRegistry;
	readonly currentPath: string;
	readonly onNavigate: (path: string) => void;
	readonly children: ReactNode;
}

/**
 * App shell: sidebar built dynamically from the PluginRegistry (public
 * metadata only — ids, names, versions; never entry paths) and a content
 * area where the PluginRenderer mounts the active module.
 */
export function MainLayout({ registry, currentPath, onNavigate, children }: MainLayoutProps): ReactElement {
	const plugins = registry.list();

	const navigate = (event: MouseEvent<HTMLAnchorElement>, path: string): void => {
		event.preventDefault();
		onNavigate(path);
	};

	return (
		<div className="app-shell">
			<aside className="sidebar">
				<a className="brand" href="/" onClick={event => navigate(event, '/')}>
					SaaS Foundry
				</a>
				<nav aria-label="Módulos">
					<ul>
						{plugins.map(plugin => {
							const path = `/plugins/${plugin.id}`;
							return (
								<li key={plugin.id}>
									<a
										href={path}
										aria-current={currentPath === path ? 'page' : undefined}
										onClick={event => navigate(event, path)}
									>
										{plugin.displayName ?? plugin.id} <small>v{plugin.version}</small>
									</a>
								</li>
							);
						})}
					</ul>
				</nav>
			</aside>
			<main className="content">{children}</main>
		</div>
	);
}
