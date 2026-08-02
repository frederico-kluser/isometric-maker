/**
 * Tela inicial — a bifurcação entre as duas coisas que o editor faz.
 *
 * Existe porque os dois construtores viraram UM aplicativo servido por um Vite
 * só: sem uma raiz, `/` teria que escolher arbitrariamente uma das telas, e a
 * outra viraria uma URL que só quem já conhece encontra.
 *
 * Cada entrada é um `<button>` de verdade, não uma `<div>` com `onClick`: o
 * foco por Tab, o Enter e o Espaço vêm de graça, e o leitor de tela anuncia
 * "botão" em vez de nada.
 *
 * Além dos dois caminhos, a tela importa um pacote de projeto (ADR 0033): o
 * arquivo .isomaker.json exportado no editor de mapa. A pré-checagem do
 * `version` acontece aqui, na escolha do arquivo — qualquer outro JSON é
 * recusado sem POST. O servidor restaura personagem e blocos; em sucesso, a
 * tela navega para o editor de mapa.
 */
import { useRef, useState } from 'react';
import { BoxIcon, FolderOpenIcon, Grid3x3Icon, UserRoundIcon } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { S } from '../../strings.ts';
import { navigate, type Route } from '../router.ts';

export function HomeScreen() {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  /**
   * Lê o pacote escolhido e o envia a POST /api/project/import. Em sucesso,
   * navega para o editor de mapa — o servidor já restaurou personagem e
   * blocos. A mensagem de erro do servidor aparece verbatim (ela já nomeia o
   * campo com problema).
   */
  const importProject = async (chosen: File | undefined): Promise<void> => {
    if (!chosen) return;
    setImporting(true);
    setErrorMsg(null);
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await chosen.text());
      } catch {
        setErrorMsg(S.inicio.projectImport.arquivoInvalido);
        return;
      }
      const rec = parsed as Record<string, unknown> | null;
      if (rec === null || typeof rec !== 'object' || rec['version'] !== 1) {
        setErrorMsg(S.inicio.projectImport.formatoInvalido);
        return;
      }
      const res = await fetch('/api/project/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      navigate('mundo');
    } catch (err) {
      setErrorMsg(
        S.inicio.projectImport.erro(
          err instanceof Error ? err.message : String(err),
        ),
      );
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col justify-center gap-10 p-6 antialiased">
      <header className="flex flex-col gap-2 text-center">
        <h1 className="text-balance text-4xl font-semibold tracking-tight">
          {S.inicio.appTitle}
        </h1>
        <p className="text-balance text-sm text-muted-foreground">
          {S.inicio.tagline}
        </p>
      </header>

      <nav
        aria-label={S.inicio.entriesAriaLabel}
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
      >
        <HomeEntry
          route="personagem"
          icon={UserRoundIcon}
          title={S.inicio.character.title}
          description={S.inicio.character.description}
          cta={S.inicio.character.cta}
        />
        <HomeEntry
          route="mundo"
          icon={Grid3x3Icon}
          title={S.inicio.world.title}
          description={S.inicio.world.description}
          cta={S.inicio.world.cta}
        />
        <HomeEntry
          route="mundo3d"
          icon={BoxIcon}
          title="Editor de Mapa 3D"
          description="Construa mapas em 3D com câmera livre. Coloque blocos mirando nas faces — estilo Minecraft."
          cta="Abrir editor 3D"
        />
      </nav>

      <div className="mx-auto flex w-full max-w-sm flex-col items-center gap-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={importing}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card px-6 py-3 text-sm font-medium text-card-foreground transition-colors hover:border-primary hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60"
        >
          <FolderOpenIcon aria-hidden className="size-4 text-primary" />
          {importing
            ? S.inicio.projectImport.importando
            : S.inicio.projectImport.titulo}
        </button>
        <p className="text-center text-xs text-muted-foreground">
          {S.inicio.projectImport.descricao}
        </p>
        {errorMsg !== null ? (
          <p role="alert" className="text-center text-xs text-destructive">
            {errorMsg}
          </p>
        ) : null}
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            void importProject(e.target.files?.[0]);
            // Reset para escolher o MESMO arquivo de novo disparar change.
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}

interface HomeEntryProps {
  readonly route: Route;
  readonly icon: LucideIcon;
  readonly title: string;
  readonly description: string;
  readonly cta: string;
}

function HomeEntry({
  route,
  icon: Icon,
  title,
  description,
  cta,
}: HomeEntryProps) {
  return (
    <button
      type="button"
      onClick={() => navigate(route)}
      className="group flex min-h-56 flex-col items-start gap-3 rounded-xl border border-border bg-card p-6 text-left text-card-foreground transition-colors hover:border-primary hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      <Icon aria-hidden className="size-8 text-primary" />
      <span className="text-xl font-semibold">{title}</span>
      <span className="text-sm text-muted-foreground">{description}</span>
      <span className="mt-auto text-sm font-medium text-primary group-hover:underline">
        {cta}
      </span>
    </button>
  );
}
