import { createContext, useContext, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import {
	onAuthStateChanged,
	signInWithEmailAndPassword,
	signOut as firebaseSignOut,
	type User
} from 'firebase/auth';
import { Loader2 } from 'lucide-react';
import { getFirebase } from '../services/firebaseConfig';
import { LoginScreen } from './LoginScreen';

export type UserRole = 'SUPER_ADMIN' | 'USER';

export interface AuthState {
	readonly user: User | null;
	/** Vem dos custom claims do token (setados só pelo servidor/firebase-admin). */
	readonly role: UserRole;
	readonly loading: boolean;
	readonly signIn: (email: string, password: string) => Promise<void>;
	readonly signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
	const state = useContext(AuthContext);
	if (!state) {
		throw new Error('useAuth: fora do AuthProvider');
	}
	return state;
}

export function AuthProvider({ children }: { readonly children: ReactNode }): ReactElement {
	const { auth } = getFirebase();
	const [user, setUser] = useState<User | null>(null);
	const [role, setRole] = useState<UserRole>('USER');
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		return onAuthStateChanged(auth, current => {
			setUser(current);
			if (!current) {
				setRole('USER');
				setLoading(false);
				return;
			}
			// Fonte da role: custom claim assinado no token — o cliente não consegue forjar.
			void current.getIdTokenResult().then(result => {
				setRole(result.claims['role'] === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : 'USER');
				setLoading(false);
			});
		});
	}, [auth]);

	const value = useMemo<AuthState>(
		() => ({
			user,
			role,
			loading,
			signIn: async (email, password) => {
				await signInWithEmailAndPassword(auth, email, password);
			},
			signOut: () => firebaseSignOut(auth)
		}),
		[auth, user, role, loading]
	);

	return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Route guard: unauthenticated sessions only ever see the login screen. */
export function RequireAuth({ children }: { readonly children: ReactNode }): ReactElement {
	const { user, loading } = useAuth();

	if (loading) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-gray-50">
				<Loader2 className="h-6 w-6 animate-spin text-gray-400" aria-label="Carregando sessão" />
			</div>
		);
	}
	if (!user) {
		return <LoginScreen />;
	}
	return <>{children}</>;
}
