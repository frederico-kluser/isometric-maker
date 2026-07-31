/**
 * Criação guiada de peça do guarda-roupa, em três passos dentro do sheet
 * do registry @motion: nome → slot → prompt de edição (com "manter paleta").
 *
 * O slot usa segmented-toggle e NÃO o select do shadcn de propósito: o popup
 * do select abre num portal no <body>, e o sheet é um <dialog> modal nativo
 * (top layer) — o popup renderizaria atrás do sheet, inclicável. O toggle
 * cobre a mesma escolha única com rótulos em pt-BR sem sair do dialog.
 *
 * O POST vai com a silhueta do personagem SELECIONADO: a peça nasce valendo
 * para todo corpo daquela silhueta.
 */
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Sheet,
  SheetBackdrop,
  SheetClose,
  SheetHandle,
  SheetPanel,
} from '@/components/motion-ui/sheet';
import {
  SegmentedToggle,
  SegmentedToggleOption,
} from '@/components/motion-ui/segmented-toggle';
import type {
  Silhouette,
  WardrobeItem,
  WardrobeSlot,
} from '../../../../server/model.ts';
import { api } from '../../studio-store.tsx';
import { S } from '../../../strings.ts';
import { passoAtual } from '../../../strings/itens.ts';

const SLOT_ORDER = [
  'cabeca',
  'torso',
  'pernas',
  'pes',
  'maos',
  'arma',
  'costas',
] as const satisfies readonly WardrobeSlot[];

const TOTAL_STEPS = 3;

export interface CreateItemSheetProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Silhueta do personagem selecionado — a peça nasce presa a ela. */
  readonly silhouette: Silhouette;
  /** Recarrega o estúdio depois do cadastro. */
  readonly onCreated: () => Promise<void>;
}

export function CreateItemSheet({
  open,
  onOpenChange,
  silhouette,
  onCreated,
}: CreateItemSheetProps) {
  const [step, setStep] = useState(0);
  const [label, setLabel] = useState('');
  const [slot, setSlot] = useState<WardrobeSlot>('torso');
  const [editDescription, setEditDescription] = useState('');
  const [keepPalette, setKeepPalette] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Toda abertura recomeça o fluxo do zero.
  useEffect(() => {
    if (!open) return;
    setStep(0);
    setLabel('');
    setSlot('torso');
    setEditDescription('');
    setKeepPalette(true);
    setSubmitting(false);
    setError(null);
  }, [open]);

  const canContinue =
    step === 0 ? label.trim().length > 0 : step === 2 ? editDescription.trim().length > 0 : true;

  const submit = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      await api<WardrobeItem>('wardrobe', {
        method: 'POST',
        body: JSON.stringify({
          label: label.trim(),
          slot,
          editDescription: editDescription.trim(),
          silhouette,
          keepPalette,
          seed: Math.floor(Math.random() * 100000),
        }),
      });
      await onCreated();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const advance = (): void => {
    if (step < TOTAL_STEPS - 1) {
      setStep(step + 1);
      return;
    }
    void submit();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetBackdrop />
      <SheetPanel labelledBy="criar-peca-titulo">
        <SheetHandle />
        <div className="flex items-start justify-between gap-3 pt-1">
          <div className="flex flex-col gap-1">
            <h3 id="criar-peca-titulo" className="text-base font-semibold">
              {S.itens.criar.titulo}
            </h3>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {passoAtual(step + 1, TOTAL_STEPS)}
              </span>
              <span className="flex items-center gap-1" aria-hidden="true">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className={`size-1.5 rounded-full ${i === step ? 'bg-primary' : 'bg-muted'}`}
                  />
                ))}
              </span>
            </div>
          </div>
          <SheetClose label={S.itens.criar.fechar} />
        </div>

        <div className="flex min-h-44 flex-col gap-3 py-4">
          {step === 0 && (
            <>
              <p className="text-sm font-medium">{S.itens.criar.passoNomeTitulo}</p>
              <p className="text-sm text-muted-foreground">
                {S.itens.criar.passoNomeTexto}
              </p>
              <div className="flex flex-col gap-1.5 pt-1">
                <Label htmlFor="peca-nome">{S.itens.criar.nomeLabel}</Label>
                <Input
                  id="peca-nome"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder={S.itens.criar.nomePlaceholder}
                  maxLength={80}
                />
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <p className="text-sm font-medium">{S.itens.criar.passoSlotTitulo}</p>
              <div className="flex flex-col gap-1.5 pt-1">
                <span id="peca-slot-label" className="text-sm font-medium">
                  {S.itens.criar.slotLabel}
                </span>
                <SegmentedToggle
                  value={slot}
                  onChange={setSlot}
                  ariaLabel={S.itens.criar.slotLabel}
                  className="flex-wrap"
                >
                  {SLOT_ORDER.map((s) => (
                    <SegmentedToggleOption key={s} value={s}>
                      {S.itens.slots[s]}
                    </SegmentedToggleOption>
                  ))}
                </SegmentedToggle>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <p className="text-sm font-medium">
                {S.itens.criar.passoEdicaoTitulo}
              </p>
              <p className="text-xs text-muted-foreground">
                {S.itens.criar.resumoNome}: {label.trim()} ·{' '}
                {S.itens.criar.resumoSlot}: {S.itens.slots[slot]}
              </p>
              <div className="flex flex-col gap-1.5 pt-1">
                <Label htmlFor="peca-edicao">{S.itens.criar.edicaoLabel}</Label>
                <Textarea
                  id="peca-edicao"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder={S.itens.criar.edicaoPlaceholder}
                  maxLength={300}
                />
                <p className="text-xs text-muted-foreground">
                  {S.itens.criar.edicaoHint}
                </p>
              </div>
              <div className="flex flex-col gap-1 pt-1">
                {/* O Checkbox do Base UI renderiza um <button> — <label> não o
                    ativa por clique; a área de hit ampliada é do próprio
                    componente (after:-inset). */}
                <Label>
                  <Checkbox
                    checked={keepPalette}
                    onCheckedChange={(checked) =>
                      setKeepPalette(checked === true)
                    }
                  />
                  {S.itens.criar.manterPaleta}
                </Label>
                <p className="pl-6 text-xs text-muted-foreground">
                  {S.itens.criar.manterPaletaHint}
                </p>
              </div>
            </>
          )}

          {error !== null && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
          <Button
            variant="outline"
            onClick={() => setStep(step - 1)}
            disabled={step === 0 || submitting}
          >
            {S.itens.criar.voltar}
          </Button>
          <Button onClick={advance} disabled={!canContinue || submitting}>
            {step === TOTAL_STEPS - 1
              ? submitting
                ? S.itens.criar.cadastrando
                : S.itens.criar.cadastrar
              : S.itens.criar.continuar}
          </Button>
        </div>
      </SheetPanel>
    </Sheet>
  );
}
