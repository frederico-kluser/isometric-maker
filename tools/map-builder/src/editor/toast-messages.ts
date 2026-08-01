/**
 * Fila de avisos com texto — wrapper fino sobre `useToastStack`.
 *
 * O componente do catálogo é headless de propósito: ele entrega a ordem dos ids
 * e nada mais. O texto é responsabilidade de quem usa. Este wrapper existe
 * porque a regra é clara — editar o source instalado em `components/motion-ui/`
 * é perdê-lo no próximo `shadcn add`.
 */
import { useCallback, useRef, useState } from 'react';
import { useToastStack, type ToastItem } from '@/components/motion-ui/toast-stack';

export interface MessageQueue {
  readonly toasts: ToastItem[];
  /** Enfileira um aviso e devolve o id. */
  readonly push: (message: string) => ToastItem;
  readonly dismiss: (id: ToastItem) => void;
  readonly textOf: (id: ToastItem) => string;
}

export function useMessages(): MessageQueue {
  const stack = useToastStack();
  const [, force] = useState(0);
  // Map em ref, não em estado: o id só existe DEPOIS de add(), e gravar o texto
  // num setState aqui criaria um quadro em que o toast já está montado e ainda
  // não tem o que dizer.
  const texts = useRef(new Map<ToastItem, string>());

  const push = useCallback(
    (message: string): ToastItem => {
      const id = stack.add();
      texts.current.set(id, message);
      force((n) => n + 1);
      return id;
    },
    [stack],
  );

  const dismiss = useCallback(
    (id: ToastItem): void => {
      texts.current.delete(id);
      stack.dismiss(id);
    },
    [stack],
  );

  const textOf = useCallback((id: ToastItem): string => texts.current.get(id) ?? '', []);

  return { toasts: stack.toasts, push, dismiss, textOf };
}
