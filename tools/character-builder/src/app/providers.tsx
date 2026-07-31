import type { ReactNode } from 'react';
import { MotionUIThemeProvider } from '@/components/motion-ui/ui-theme';
import motionTheme from '../../motion.theme.ts';
import { SelectedCharacterProvider } from './studio-store.tsx';

/**
 * Providers da aplicação. O MotionUIThemeProvider é montado uma única vez,
 * aqui na raiz — sem ele tudo cai nos defaults do tema.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <MotionUIThemeProvider theme={motionTheme}>
      <SelectedCharacterProvider>{children}</SelectedCharacterProvider>
    </MotionUIThemeProvider>
  );
}
