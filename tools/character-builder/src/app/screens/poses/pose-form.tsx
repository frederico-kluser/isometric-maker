import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import {
  Sheet,
  SheetBackdrop,
  SheetClose,
  SheetHandle,
  SheetPanel,
  SheetTrigger,
} from '@/components/motion-ui/sheet';
import {
  SegmentedToggle,
  SegmentedToggleOption,
} from '@/components/motion-ui/segmented-toggle';
import { MultiStateButton } from '@/components/motion-ui/multi-state-button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  TEMPLATE_ANIMATIONS,
  type MannequinLock,
  type TemplateAnimation,
} from '../../../../server/model.ts';
import { api } from '../../studio-store.tsx';
import { framesTravados, poses as t } from '../../../strings/poses.ts';

/** O formulário só oferece os dois caminhos de geração por API — esqueleto
 *  manual ficou de fora de propósito (não há editor visual de keypoints). */
type PoseKindChoice = 'template' | 'action';

/** Quanto o estado de erro fica visível antes de voltar ao repouso. */
const ERROR_STATE_MS = 1600;
/** Pausa para o "pop" de sucesso ser visto antes de fechar o sheet. */
const CLOSE_AFTER_SUCCESS_MS = 900;

interface PoseFormProps {
  /** Contrato de frames travado pelo Wizard; ausente antes da base. */
  readonly lock: MannequinLock | undefined;
  /** Recarrega o estúdio depois do cadastro. */
  readonly onDone: () => Promise<void>;
}

/**
 * Cadastro de pose nova, em sheet (dialog nativo com foco preso e Esc) em
 * vez de card expansível: é um fluxo pontual de criação, não a navegação de
 * detalhes de um item da lista — e a grade, conteúdo principal, fica visível
 * atrás do scrim.
 *
 * frameCount NÃO é pedido: vem do lock do manequim e aparece como selo
 * travado (sem lock, uma nota explica que o Wizard trava). O POST vai com
 * {label, kind, templateId?|action?, fps} — o servidor deriva o resto.
 */
export function PoseForm({ lock, onDone }: PoseFormProps) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<PoseKindChoice>('template');
  const [templateId, setTemplateId] =
    useState<TemplateAnimation>('breathing-idle');
  const [action, setAction] = useState('');
  const [fps, setFps] = useState('8');
  const [state, setState] = useState<'idle' | 'posting' | 'criada' | 'erro'>(
    'idle',
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
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

  const valid =
    label.trim().length > 0 &&
    (kind === 'template' || action.trim().length > 0);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!valid || state === 'posting') return;
    setState('posting');
    setErrorMsg(null);

    const fpsNum = Math.min(30, Math.max(1, Number.parseInt(fps, 10) || 8));
    const body: Record<string, unknown> = {
      label: label.trim(),
      kind,
      fps: fpsNum,
    };
    if (kind === 'template') body['templateId'] = templateId;
    else body['action'] = action.trim();

    try {
      await api('poses', { method: 'POST', body: JSON.stringify(body) });
      await onDone();
      setState('criada');
      later(() => {
        setOpen(false);
        setState('idle');
        setLabel('');
        setAction('');
        setFps('8');
      }, CLOSE_AFTER_SUCCESS_MS);
    } catch (err) {
      setState('erro');
      setErrorMsg(err instanceof Error ? err.message : String(err));
      later(() => setState('idle'), ERROR_STATE_MS);
    }
  };

  const buttonLabel =
    state === 'posting'
      ? t.cadastrando
      : state === 'criada'
        ? t.cadastrada
        : state === 'erro'
          ? t.erroCadastro
          : t.cadastrar;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger>
        <Plus aria-hidden="true" className="size-4" />
        {t.novaPose}
      </SheetTrigger>
      <SheetBackdrop />
      <SheetPanel labelledBy="pose-form-title">
        <SheetHandle />
        <div className="flex items-center justify-between gap-4 pb-3">
          <h3 id="pose-form-title" className="text-base font-semibold">
            {t.formTitle}
          </h3>
          <SheetClose label={t.fechar} />
        </div>

        <form
          onSubmit={(event) => void submit(event)}
          className="flex flex-col gap-4"
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pose-label">{t.nomeLabel}</Label>
            <Input
              id="pose-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder={t.nomePlaceholder}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{t.kindLabel}</Label>
            <SegmentedToggle
              value={kind}
              onChange={setKind}
              ariaLabel={t.kindLabel}
            >
              <SegmentedToggleOption value="template">
                {t.kindTemplate}
              </SegmentedToggleOption>
              <SegmentedToggleOption value="action">
                {t.kindTexto}
              </SegmentedToggleOption>
            </SegmentedToggle>
          </div>

          {kind === 'template' ? (
            <div className="flex flex-col gap-1.5">
              <Label>{t.templateLabel}</Label>
              <Select
                value={templateId}
                onValueChange={(value) =>
                  setTemplateId(value as TemplateAnimation)
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TEMPLATE_ANIMATIONS.map((tpl) => (
                    <SelectItem key={tpl} value={tpl}>
                      {tpl}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pose-action">{t.acaoLabel}</Label>
              <Input
                id="pose-action"
                value={action}
                onChange={(event) => setAction(event.target.value)}
                placeholder={t.acaoPlaceholder}
              />
            </div>
          )}

          <div className="flex items-end gap-6">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pose-fps">{t.fpsLabel}</Label>
              <Input
                id="pose-fps"
                type="number"
                min={1}
                max={30}
                value={fps}
                onChange={(event) => setFps(event.target.value)}
                className="w-20"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{t.framesLabel}</Label>
              {lock ? (
                <Badge variant="secondary" className="h-8 px-2.5">
                  {framesTravados(lock.frameCount)}
                </Badge>
              ) : (
                <p className="max-w-56 text-xs text-muted-foreground">
                  {t.semLock}
                </p>
              )}
            </div>
          </div>

          <p className="text-xs text-muted-foreground">{t.notaWalkRunJump}</p>

          {errorMsg !== null ? (
            <p className="text-xs text-destructive">{errorMsg}</p>
          ) : null}

          <MultiStateButton
            type="submit"
            state={state}
            feedback={
              state === 'criada' ? 'pop' : state === 'erro' ? 'shake' : 'none'
            }
            disabled={!valid || state === 'posting'}
            surfaceClassName={
              state === 'criada'
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
