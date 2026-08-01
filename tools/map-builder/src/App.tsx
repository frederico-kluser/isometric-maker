import { MotionUIThemeProvider } from '@/components/motion-ui/ui-theme';
import motionTheme from '../motion.theme.ts';
import { MapEditor } from './editor/map-editor.tsx';

/**
 * O provider do tema é montado UMA vez, na raiz. Sem ele, cada componente do
 * Motion UI cai nos defaults internos e as durações deixam de conversar entre si.
 */
export function App() {
  return (
    <MotionUIThemeProvider theme={motionTheme}>
      <MapEditor />
    </MotionUIThemeProvider>
  );
}
