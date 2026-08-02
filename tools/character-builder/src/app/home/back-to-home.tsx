/**
 * Volta para a tela inicial.
 *
 * Um componente só, usado pelas duas telas: se cada uma escrevesse o seu, o
 * caminho de volta acabaria em lugar diferente em cada canto — e uma tela sem
 * saída visível é a forma mais rápida de um roteador parecer quebrado.
 */
import { ArrowLeftIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { S } from '../../strings.ts';
import { navigate } from '../router.ts';

export function BackToHome({ className }: { readonly className?: string }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => navigate('inicio')}
      aria-label={S.inicio.back.ariaLabel}
      {...(className === undefined ? {} : { className })}
    >
      <ArrowLeftIcon className="size-4" />
      {S.inicio.back.label}
    </Button>
  );
}
