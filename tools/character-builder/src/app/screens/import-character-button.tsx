/**
 * Importação de personagem via JSON — botão de cabeçalho compartilhado
 * pelas abas Poses e Itens (mesmo componente, strings da tela hospedeira).
 *
 * Aceita só os dois bundles que o estúdio exporta: `sprite-wizard-directions`
 * (Wizard — 8 direções prontas) e `sprite-lab-south` (Laboratório — pose sul;
 * o personagem novo continua no Wizard). A pré-checagem do `kind` acontece no
 * cliente, na escolha do arquivo — recusa imediata, sem POST. A validação
 * completa (PNG, campos, conflito de id) é do servidor no
 * POST /api/characters/import, cuja mensagem aparece verbatim.
 *
 * Em sucesso, o personagem importado vira o selecionado do app inteiro e o
 * estúdio recarrega (refresh do useStudio da tela hospedeira — o componente
 * não abre um segundo poll).
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Upload } from 'lucide-react';
import {
  Sheet,
  SheetBackdrop,
  SheetClose,
  SheetHandle,
  SheetPanel,
  SheetTrigger,
} from '@/components/motion-ui/sheet';
import { MultiStateButton } from '@/components/motion-ui/multi-state-button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Character } from '../../../server/model.ts';
import { api, useSelectedCharacter } from '../studio-store.tsx';

/** Os dois únicos `kind` de bundle que a importação aceita (TASK_PLAN). */
const ACCEPTED_KINDS: ReadonlySet<string> = new Set([
  'sprite-wizard-directions',
  'sprite-lab-south',
]);

/**
 * Fatia de strings que a tela hospedeira injeta — o bloco `importar` de
 * `strings/poses.ts` ou de `strings/itens.ts` (idênticos, por escolha: cada
 * tela é dona das próprias strings).
 */
export interface ImportCharacterStrings {
  readonly botao: string;
  readonly titulo: string;
  readonly fechar: string;
  readonly explicacao: string;
  readonly nomeLabel: string;
  readonly nomePlaceholder: string;
  readonly arquivoLabel: string;
  readonly arquivoEscolher: string;
  readonly enviar: string;
  readonly enviando: string;
  readonly importado: string;
  readonly erroEnvio: string;
  readonly arquivoInvalido: string;
  readonly kindInvalido: string;
}

/** Arquivo escolhido e pré-checado: nome para exibição, bundle para o POST. */
interface ChosenFile {
  readonly name: string;
  readonly bundle: unknown;
}

interface ImportCharacterButtonProps {
  readonly strings: ImportCharacterStrings;
  /** Recarrega o estúdio depois da importação (vem do useStudio da tela). */
  readonly refresh: () => Promise<void>;
}

/** Quanto o estado de erro fica visível antes de voltar ao repouso. */
const ERROR_STATE_MS = 1600;
/** Pausa para o "pop" de sucesso ser visto antes de fechar o sheet. */
const CLOSE_AFTER_SUCCESS_MS = 900;

export function ImportCharacterButton({
  strings: t,
  refresh,
}: ImportCharacterButtonProps) {
  const { setCharacterId } = useSelectedCharacter();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [file, setFile] = useState<ChosenFile | null>(null);
  const [state, setState] = useState<'idle' | 'posting' | 'importado' | 'erro'>(
    'idle',
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timers = useRef<number[]>([]);

  useEffect(
    () => () => {
      for (const id of timers.current) window.clearTimeout(id);
    },
    [],
  );

  const later = (fn: () => void, ms: number): void => {
    timers.current.push(window.setTimeout(fn, ms));
  };

  const valid = label.trim().length > 0 && file !== null;

  /**
   * Lê o arquivo e pré-checa o `kind`: só sobem os dois bundles exportados
   * pelo estúdio — qualquer outro JSON é recusado aqui mesmo, sem POST.
   */
  const acceptFile = async (chosen: File | undefined): Promise<void> => {
    if (!chosen) return;
    try {
      const parsed: unknown = JSON.parse(await chosen.text());
      const kind =
        typeof parsed === 'object' && parsed !== null && 'kind' in parsed
          ? (parsed as Record<string, unknown>)['kind']
          : undefined;
      if (typeof kind !== 'string' || !ACCEPTED_KINDS.has(kind)) {
        setFile(null);
        setErrorMsg(t.kindInvalido);
        return;
      }
      setErrorMsg(null);
      setFile({ name: chosen.name, bundle: parsed });
    } catch {
      setFile(null);
      setErrorMsg(t.arquivoInvalido);
    }
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!valid || state === 'posting' || file === null) return;
    setState('posting');
    setErrorMsg(null);

    try {
      const character = await api<Character>('characters/import', {
        method: 'POST',
        body: JSON.stringify({ label: label.trim(), bundle: file.bundle }),
      });
      // O importado vira o selecionado do app inteiro antes do refresh, para
      // a grade/cards já abrirem nele quando o estado novo chegar.
      setCharacterId(character.id);
      await refresh();
      setState('importado');
      later(() => {
        setOpen(false);
        setState('idle');
        setLabel('');
        setFile(null);
      }, CLOSE_AFTER_SUCCESS_MS);
    } catch (err) {
      setState('erro');
      // Verbatim: a mensagem do servidor já nomeia o campo com problema.
      setErrorMsg(err instanceof Error ? err.message : String(err));
      later(() => setState('idle'), ERROR_STATE_MS);
    }
  };

  const buttonLabel =
    state === 'posting'
      ? t.enviando
      : state === 'importado'
        ? t.importado
        : state === 'erro'
          ? t.erroEnvio
          : t.enviar;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger>
        <Upload aria-hidden="true" className="size-4" />
        {t.botao}
      </SheetTrigger>
      <SheetBackdrop />
      <SheetPanel labelledBy="import-character-title">
        <SheetHandle />
        <div className="flex items-center justify-between gap-4 pb-3">
          <h3 id="import-character-title" className="text-base font-semibold">
            {t.titulo}
          </h3>
          <SheetClose label={t.fechar} />
        </div>

        <form
          onSubmit={(event) => void submit(event)}
          className="flex flex-col gap-4"
        >
          <p className="text-xs text-muted-foreground">{t.explicacao}</p>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="import-character-label">{t.nomeLabel}</Label>
            <Input
              id="import-character-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder={t.nomePlaceholder}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{t.arquivoLabel}</Label>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/40 px-3 py-2 text-center text-sm transition-colors hover:bg-accent/60"
            >
              <span className="truncate text-muted-foreground">
                {file !== null ? file.name : t.arquivoEscolher}
              </span>
            </button>
            <input
              ref={inputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                void acceptFile(e.target.files?.[0]);
                // Reset para escolher o MESMO arquivo de novo disparar change.
                e.target.value = '';
              }}
            />
          </div>

          {errorMsg !== null ? (
            <p role="alert" className="text-xs text-destructive">
              {errorMsg}
            </p>
          ) : null}

          <MultiStateButton
            type="submit"
            state={state}
            feedback={
              state === 'importado' ? 'pop' : state === 'erro' ? 'shake' : 'none'
            }
            disabled={!valid || state === 'posting'}
            surfaceClassName={
              state === 'importado'
                ? 'bg-secondary text-secondary-foreground'
                : 'bg-primary text-primary-foreground'
            }
            className="self-start"
          >
            {buttonLabel}
          </MultiStateButton>
        </form>
      </SheetPanel>
    </Sheet>
  );
}
