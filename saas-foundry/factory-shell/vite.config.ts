import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
	plugins: [react(), tailwindcss()],
	server: { port: 5173 },
	build: {
		rollupOptions: {
			output: {
				// Vendors estáveis em chunks próprios: cache de longo prazo no browser
				// e o chunk da aplicação fica pequeno a cada deploy.
				manualChunks: {
					react: ['react', 'react-dom'],
					firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore'],
					motion: ['framer-motion']
				}
			}
		}
	}
});
