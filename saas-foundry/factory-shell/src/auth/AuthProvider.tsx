import { createContext, useContext, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import {
	GoogleAuthProvider,
	createUserWithEmailAndPassword,
	onAuthStateChanged,
	sendSignInLinkToEmail,
	signInWithEmailAndPassword,
	signInWithPopup,
	signOut as firebaseSignOut,
	updateProfile,
	type User
} from 'firebase/auth';
import { Loader2 } from 'lucide-react';
import { getFirebase } from '../services/firebaseConfig';
import { AuthPage } from './AuthPage';

export type UserRole = 'SUPER_ADMIN' | 'USER';

export interface AuthState {
	readonly user: User | null;
	/** Vem dos custom claims do token (setados só pelo servidor/firebase-admin). */
	readonly role: UserRole;
	readonly loading: boolean;
	readonly signIn: (email: string, password: string) => Promise<void>;
	readonly signUp: (email: string, password: string, company: string) => Promise<void>;
	readonly signInWithGoogle: () => Promise<void>;
	readonly sendMagicLink: (email: string) => Promise<void>;
	readonly signOut: () => Promise<void>;
}

/** Onde o usuário volta a cair ao clicar no link mágico do e-mail. */
const MAGIC_LINK_SETTINGS = {
	get url(): string { return `${window.location.origin}/app`; },
	handleCodeInApp: true
} as const;

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
			signUp: async (email, password, company) => {
				const credential = await createUserWithEmailAndPassword(auth, email, password);
				if (company.trim()) {
					await updateProfile(credential.user, { displayName: company.trim() });
				}
			},
			signInWithGoogle: async () => {
				await signInWithPopup(auth, new GoogleAuthProvider());
			},
			sendMagicLink: async email => {
				await sendSignInLinkToEmail(auth, email, { url: MAGIC_LINK_SETTINGS.url, handleCodeInApp: MAGIC_LINK_SETTINGS.handleCodeInApp });
				window.localStorage.setItem('foundry:magic-email', email);
			},
			signOut: () => firebaseSignOut(auth)
		}),
		[auth, user, role, loading]
	);

	return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Route guard: unauthenticated sessions only ever see a tela unificada de acesso. */
export function RequireAuth({ children }: { readonly children: ReactNode }): ReactElement {
	const { user, loading, signIn, signUp, signInWithGoogle, sendMagicLink } = useAuth();

	if (loading) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-gray-50">
				<Loader2 className="h-6 w-6 animate-spin text-gray-400" aria-label="Carregando sessão" />
			</div>
		);
	}
	if (!user) {
		return (
			<AuthPage
				handlers={{
					onPasswordLogin: ({ email, password }) => signIn(email, password),
					onSignUp: ({ email, password, company }) => signUp(email, password, company),
					onGoogle: signInWithGoogle,
					onMagicLink: sendMagicLink
				}}
			/>
		);
	}
	return <>{children}</>;
}
