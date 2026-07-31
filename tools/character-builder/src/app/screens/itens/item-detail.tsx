/**
 * Conteúdo do painel expandido de uma peça (expand-card).
 *
 * Mostra o que o card resume: a faixa das oito direções em tamanho grande,
 * o prompt de edição completo e os metadados que decidem a geração
 * (silhueta da peça, paleta, seed). O botão Gerar é o mesmo do card.
 */
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useExpandCard } from '@/components/motion-ui/expand-card';
import { S } from '../../../strings.ts';
import { silhuetaIncompativelDetalhe } from '../../../strings/itens.ts';
import { itemStatus } from './item-state.ts';
import { DirectionStrip } from './direction-strip.tsx';
import {
  GenerateButton,
  statusLine,
  type WardrobeCardProps,
} from './wardrobe-card.tsx';

function CloseGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

export function ItemDetail(props: WardrobeCardProps) {
  const { item, cell } = props;
  const status = itemStatus(item, props.character, cell);
  const { close } = useExpandCard();

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <h3
            id={`item-${item.id}-titulo`}
            className="text-lg leading-snug font-semibold"
          >
            {item.label}
          </h3>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary">{S.itens.slots[item.slot]}</Badge>
            <Badge variant="outline">{S.itens.silhuetas[item.silhouette]}</Badge>
            {status.availability === 'mismatch' && (
              <Badge variant="destructive">{S.itens.gerar.naoServe}</Badge>
            )}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={close}
          aria-label={S.itens.detalhe.fechar}
        >
          <CloseGlyph />
        </Button>
      </div>

      {status.availability === 'mismatch' && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {silhuetaIncompativelDetalhe(
            S.itens.silhuetas[item.silhouette],
            S.itens.silhuetas[props.character.silhouette],
          )}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {S.itens.detalhe.direcoesTitulo}
        </h4>
        {status.action === 'working' ? (
          <DirectionStrip frames={undefined} loading size="lg" />
        ) : (
          <DirectionStrip frames={cell?.frames} size="lg" />
        )}
        {status.action === 'done' && (
          <p className="text-xs text-muted-foreground">
            {S.itens.detalhe.passeMouse}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {S.itens.detalhe.promptTitulo}
        </h4>
        <p className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          “{item.editDescription}”
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs text-muted-foreground">
            {S.itens.detalhe.silhuetaTitulo}
          </dt>
          <dd>{S.itens.silhuetas[item.silhouette]}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs text-muted-foreground">
            {S.itens.detalhe.paletaTitulo}
          </dt>
          <dd>
            {item.keepPalette
              ? S.itens.detalhe.paletaSim
              : S.itens.detalhe.paletaNao}
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs text-muted-foreground">
            {S.itens.detalhe.seedTitulo}
          </dt>
          <dd className="tabular-nums">{item.seed}</dd>
        </div>
      </dl>

      {status.action === 'retry' && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {cell?.error ?? S.itens.estado.falhou}
        </p>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-4">
        <span
          className={`text-xs ${status.action === 'retry' ? 'text-destructive' : 'text-muted-foreground'}`}
        >
          {statusLine(status)}
        </span>
        <GenerateButton {...props} status={status} />
      </div>
    </>
  );
}
