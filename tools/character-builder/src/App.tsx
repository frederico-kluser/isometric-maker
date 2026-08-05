/**
 * Raiz do editor: escolhe a tela pela rota.
 *
 * ## Por que `if`, e não as duas telas montadas com uma visível
 *
 * Montar as duas seria caro: a aba "Laboratório" sonda `/api/studio` a cada 3 s
 * e o painel de blocos sonda de novo por conta própria. Com as duas telas
 * montadas ao mesmo tempo, o editor de mapa ficaria sondando enquanto o usuário
 * desenha no estúdio, e vice-versa. A renderização condicional DESMONTA a tela
 * inativa — os `useEffect` de limpeza param os intervalos e o `destroy()` da
 * cena devolve o contexto WebGL.
 *
 * O custo é o inverso: voltar a uma tela remonta do zero. Numa ferramenta local
 * de usuário único, remontar é barato e sondar em segundo plano não é.
 *
 * ## O `SmoothTabs` do estúdio faz o MESMO, e isto aqui já disse o contrário
 *
 * Este comentário afirmava que o `SmoothTabs` "mantém as quatro abas montadas
 * para animar a troca". É falso: ele renderiza só a aba ativa
 * (`components/motion-ui/smooth-tabs`), e o `keepMounted` que existe lá vale
 * para o painel ATIVO durante a animação de saída — nunca monta os inativos.
 *
 * A diferença não é cosmética. Toda tela de aba PERDE o estado local ao sair, e
 * quem tem trabalho em andamento precisa reconstruí-lo de uma fonte durável no
 * servidor. O Sprite Studio aprendeu isso pagando: o `hash` da corrida vivia só
 * em estado React, sair da aba o apagava, e a sprite gerada — em disco — ficava
 * invisível. Ver `screens/laboratorio/studio-panel.tsx`.
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
