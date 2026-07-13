import { useRef, useState, type DragEvent, type ReactElement } from 'react';
import { useToast } from '@foundry/engine-core/ui';
import { motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Eye, EyeOff, FileKey, KeyRound, Loader2, Lock, ShieldCheck, UploadCloud, X } from 'lucide-react';
import { CERT_EXTENSIONS, validateCertFile } from './certFile';

export type CertStatus = 'none' | 'active';

export interface TaxSettingsProps {
	/** Estado inicial (em produção vem do backend: já existe certificado ativo?). */
	readonly initialStatus?: CertStatus;
}

/** Data de validade simulada exibida após a ativação. */
const CERT_VALID_UNTIL = '2027';

// ── Card de status atual (topo) ──────────────────────────────────────────────

function StatusCard({ status }: { readonly status: CertStatus }): ReactElement {
	if (status === 'active') {
		return (
			<motion.div
				initial={{ opacity: 0, y: 6 }}
				animate={{ opacity: 1, y: 0 }}
				data-testid="cert-status"
				data-status="active"
				className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4"
			>
				<span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-white shadow-sm shadow-emerald-500/30">
					<CheckCircle2 className="h-6 w-6" aria-hidden />
				</span>
				<div>
					<p className="text-sm font-semibold text-emerald-800">Certificado Ativo (Válido até {CERT_VALID_UNTIL})</p>
					<p className="text-xs text-emerald-700/80">Emissão automática de notas fiscais habilitada.</p>
				</div>
			</motion.div>
		);
	}
	return (
		<div data-testid="cert-status" data-status="none" className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
			<span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-400 text-amber-950 shadow-sm">
				<AlertTriangle className="h-6 w-6" aria-hidden />
			</span>
			<div>
				<p className="text-sm font-semibold text-amber-800">Emissão automática desativada</p>
				<p className="text-xs text-amber-700/80">Envie seu Certificado A1 para emitir notas sem intervenção manual.</p>
			</div>
		</div>
	);
}

// ── Tela principal ───────────────────────────────────────────────────────────

export function TaxSettings({ initialStatus = 'none' }: TaxSettingsProps): ReactElement {
	const toast = useToast();
	const [status, setStatus] = useState<CertStatus>(initialStatus);
	const [file, setFile] = useState<File | null>(null);
	const [password, setPassword] = useState('');
	const [showPassword, setShowPassword] = useState(false);
	const [dragging, setDragging] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	const accept = CERT_EXTENSIONS.join(',');

	const pickFile = (candidate: File | undefined): void => {
		if (!candidate) return;
		const result = validateCertFile(candidate);
		if (!result.ok) {
			setFile(null);
			setError(result.error ?? 'Arquivo inválido.');
			return;
		}
		setError(null);
		setFile(candidate);
	};

	const onDrop = (event: DragEvent<HTMLDivElement>): void => {
		event.preventDefault();
		setDragging(false);
		pickFile(event.dataTransfer.files[0]);
	};

	const save = async (): Promise<void> => {
		if (!file) {
			setError('Selecione o arquivo do certificado (.pfx ou .p12).');
			return;
		}
		if (!password) {
			setError('Digite a senha do certificado.');
			return;
		}
		if (saving) return;
		setError(null);
		setSaving(true);
		// PRODUÇÃO: o .pfx sobe cifrado (TLS) para um cofre isolado no servidor (KMS/HSM);
		// a senha é usada uma vez e NUNCA persiste no cliente nem em log.
		await new Promise(resolve => window.setTimeout(resolve, 1500));
		setStatus('active');
		setSaving(false);
		// Higiene de segurança: limpa o material sensível da memória após salvar.
		setPassword('');
		setFile(null);
		if (inputRef.current) inputRef.current.value = '';
		toast.success('Certificado validado e guardado com segurança. Emissão automática ativada.');
	};

	return (
		<section className="mx-auto max-w-2xl space-y-6">
			<StatusCard status={status} />

			{/* Cofre de segurança */}
			<div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-100">
				<header className="flex flex-col gap-3 border-b border-gray-100 p-6 sm:flex-row sm:items-start sm:justify-between">
					<div>
						<h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-gray-900">
							<span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-900 text-white">
								<Lock className="h-5 w-5" aria-hidden />
							</span>
							Configuração de Emissão Automática (Certificado A1)
						</h1>
						<p className="mt-1.5 text-sm text-gray-500">Envie seu certificado uma vez e emita notas fiscais no automático.</p>
					</div>
					<span className="inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
						<ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Criptografia de ponta a ponta
					</span>
				</header>

				<div className="space-y-5 p-6">
					{/* Zona de Drag & Drop */}
					<div>
						<span className="mb-1.5 block text-sm font-medium text-gray-700">Arquivo do Certificado</span>
						<div
							role="button"
							tabIndex={0}
							aria-label="Arraste o certificado ou clique para selecionar (.pfx ou .p12)"
							data-testid="cert-dropzone"
							onClick={() => inputRef.current?.click()}
							onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); inputRef.current?.click(); } }}
							onDragOver={event => { event.preventDefault(); setDragging(true); }}
							onDragLeave={() => setDragging(false)}
							onDrop={onDrop}
							className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-9 text-center transition-all ${
								dragging ? 'border-indigo-400 bg-indigo-50' : error ? 'border-red-200 bg-red-50/40' : file ? 'border-emerald-300 bg-emerald-50/50' : 'border-gray-200 bg-gray-50 hover:border-gray-300 hover:bg-gray-100/60'
							}`}
						>
							{file ? (
								<div className="flex items-center gap-3" data-testid="cert-selected">
									<span className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500 text-white">
										<FileKey className="h-5 w-5" aria-hidden />
									</span>
									<div className="text-left">
										<p className="text-sm font-semibold text-gray-900">{file.name}</p>
										<p className="text-xs text-gray-500">{(file.size / 1024).toFixed(1)} KB · pronto para validar</p>
									</div>
									<button
										type="button"
										aria-label="Remover arquivo"
										onClick={event => { event.stopPropagation(); setFile(null); if (inputRef.current) inputRef.current.value = ''; }}
										className="ml-1 flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-700"
									>
										<X className="h-4 w-4" aria-hidden />
									</button>
								</div>
							) : (
								<>
									<span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-indigo-500 shadow-sm ring-1 ring-gray-100">
										<UploadCloud className="h-6 w-6" aria-hidden />
									</span>
									<p className="mt-3 text-sm font-medium text-gray-700">Arraste e solte o certificado aqui</p>
									<p className="mt-0.5 text-xs text-gray-400">ou clique para selecionar · apenas .pfx ou .p12</p>
								</>
							)}
							<input
								ref={inputRef}
								type="file"
								accept={accept}
								data-testid="cert-file-input"
								onChange={event => pickFile(event.target.files?.[0])}
								className="hidden"
							/>
						</div>
					</div>

					{/* Senha do certificado com olhinho */}
					<label className="block">
						<span className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-gray-700">
							<KeyRound className="h-4 w-4 text-gray-400" aria-hidden /> Senha do Certificado
						</span>
						<div className="relative flex items-center rounded-xl border border-gray-200 bg-white shadow-sm transition-all focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100">
							<input
								type={showPassword ? 'text' : 'password'}
								value={password}
								onChange={event => setPassword(event.target.value)}
								autoComplete="off"
								aria-label="Senha do Certificado"
								data-testid="cert-password"
								placeholder="••••••••"
								className="w-full rounded-xl bg-transparent px-3.5 py-2.5 pr-11 text-sm text-gray-900 outline-none placeholder:text-gray-300"
							/>
							<button
								type="button"
								onClick={() => setShowPassword(current => !current)}
								aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
								aria-pressed={showPassword}
								data-testid="toggle-password"
								className="absolute right-2 flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
							>
								{showPassword ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
							</button>
						</div>
					</label>

					{error && (
						<p role="alert" data-testid="cert-error" className="flex items-center gap-2 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm font-medium text-red-600">
							<AlertTriangle className="h-4 w-4 shrink-0" aria-hidden /> {error}
						</p>
					)}

					<button
						type="button"
						onClick={() => void save()}
						disabled={saving}
						data-testid="cert-save"
						className="flex w-full items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 py-3 text-sm font-bold text-white shadow-lg transition-all hover:scale-[1.01] hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60"
					>
						{saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ShieldCheck className="h-4 w-4" aria-hidden />}
						{saving ? 'Validando com segurança…' : 'Validar e Salvar Certificado'}
					</button>
				</div>

				{/* Rodapé de confiança — tira o medo do usuário leigo */}
				<footer className="flex items-start gap-2 border-t border-gray-100 bg-gray-50 px-6 py-4 text-xs leading-relaxed text-gray-500">
					<Lock className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden />
					<span>Seu certificado é transmitido por conexão cifrada e guardado em cofre isolado (AES-256). A senha é usada apenas para validar a assinatura e <strong className="font-semibold text-gray-600">nunca é armazenada em texto puro</strong>.</span>
				</footer>
			</div>
		</section>
	);
}
