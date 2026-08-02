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
 */
import { Grid3x3Icon, UserRoundIcon } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { S } from '../../strings.ts';
import { navigate, type Route } from '../router.ts';

export function HomeScreen() {
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
        className="grid gap-4 sm:grid-cols-2"
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
      </nav>
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
