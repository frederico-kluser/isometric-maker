/**
 * Raiz do editor: escolhe a tela pela rota.
 *
 * ## Por que `if`, e não quatro telas montadas com uma visível
 *
 * O `SmoothTabs` de dentro do estúdio mantém as quatro abas montadas para
 * animar a troca. Aqui isso seria caro: a aba "Laboratório" sonda `/api/studio`
 * a cada 3 s e o painel de blocos sonda de novo por conta própria. Com as duas
 * telas montadas ao mesmo tempo, o editor de mapa ficaria sondando enquanto o
 * usuário desenha no estúdio, e vice-versa. A renderização condicional
 * DESMONTA a tela inativa — os `useEffect` de limpeza param os intervalos e o
 * `destroy()` da cena devolve o contexto WebGL.
 *
 * O custo é o inverso: voltar a uma tela remonta do zero. Numa ferramenta local
 * de usuário único, remontar é barato e sondar em segundo plano não é.
 */
import { AppProviders } from './app/providers.tsx';
import { AppShell } from './app/shell.tsx';
import { HomeScreen } from './app/home/home-screen.tsx';
import { useRoute } from './app/router.ts';
import { MapEditor3D } from './map/3d/map-editor-3d.tsx';

export function App() {
  const route = useRoute();
  return (
    <AppProviders>
      {route === 'inicio' ? (
        <HomeScreen />
      ) : route === 'personagem' ? (
        <AppShell />
      ) : (
        <MapEditor3D />
      )}
    </AppProviders>
  );
}
