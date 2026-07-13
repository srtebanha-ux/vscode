import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

const env = import.meta.env as Record<string, string | undefined>;

const firebaseConfig = {
	apiKey: env['VITE_FIREBASE_API_KEY'],
	authDomain: env['VITE_FIREBASE_AUTH_DOMAIN'],
	projectId: env['VITE_FIREBASE_PROJECT_ID'],
	storageBucket: env['VITE_FIREBASE_STORAGE_BUCKET'],
	messagingSenderId: env['VITE_FIREBASE_MESSAGING_SENDER_ID'],
	appId: env['VITE_FIREBASE_APP_ID']
};

/** Without config the shell falls back to dev mode (MockApiService) instead of crashing. */
export const isFirebaseConfigured = Boolean(
	firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId
);

export interface FirebaseServices {
	readonly app: FirebaseApp;
	readonly auth: Auth;
	readonly db: Firestore;
}

let cached: FirebaseServices | null = null;

/** Lazy singleton — nothing touches Firebase until the authenticated flow actually starts. */
export function getFirebase(): FirebaseServices {
	if (!isFirebaseConfigured) {
		throw new Error('Firebase não configurado: defina as variáveis VITE_FIREBASE_* (ver .env.example)');
	}
	if (!cached) {
		// isFirebaseConfigured garante os campos obrigatórios acima.
		const app = initializeApp(firebaseConfig as Record<string, string>);
		cached = { app, auth: getAuth(app), db: getFirestore(app) };
	}
	return cached;
}
