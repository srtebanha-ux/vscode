/**
 * Browser-safe subset of engine-core for the factory shell. Excludes
 * server-only services (FactoryService, LifecycleService) so no Node
 * builtin ever reaches a bundle. Server code should import the root.
 */
export * from './services/PluginRegistry.js';
export * from './services/MockApiService.js';
export * from './plugin-host/CoreServices.js';
export * from './components/ErrorBoundary.js';
export * from './components/PluginRenderer.js';
export * from './components/AppRouter.js';
