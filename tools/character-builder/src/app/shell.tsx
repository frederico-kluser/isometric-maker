import { useCallback, useState } from 'react';
import { S } from '../strings.ts';
import {
  SmoothTabs,
  SmoothTabsList,
  SmoothTabsPanel,
  SmoothTabsPanels,
  SmoothTabsTab,
} from '@/components/motion-ui/smooth-tabs';
import { WizardScreen } from './screens/wizard.tsx';
import { PosesScreen } from './screens/poses.tsx';
import { ItensScreen } from './screens/itens.tsx';
import { LaboratorioScreen } from './screens/laboratorio.tsx';
import { BackToHome } from './home/back-to-home.tsx';
import { QueuePanel } from './queue/queue-panel.tsx';
import { StudioNavigationProvider, type StudioTab } from './studio-navigation.tsx';

/**
 * Shell do estúdio: cabeçalho + as quatro abas principais.
 * As abas são o smooth-tabs do registry @motion (pill deslizante +
 * crossfade direcional dos painéis), não código próprio.
 *
 * Esta é a tela da rota `#/personagem`. O caminho de volta ao início fica no
 * cabeçalho porque é o único lugar visível nas quatro abas.
 *
 * ## Por que as abas viraram estado controlado
 *
 * O painel da fila (`queue/queue-panel.tsx`) é uma gaveta que flutua sobre as
 * quatro abas e precisa LEVAR o usuário até a tela dona de um job — é o único
 * caminho de "gerar de novo" para um job `'interrompido'`, cujo botão de retomar
 * vive na tela dele. O `SmoothTabs` aceita `value` + `onValueChange`, então a
 * aba aberta passou a ser estado daqui, publicado em `StudioNavigationProvider`.
 * Nada mais muda: sem consumidor, o contexto é um no-op.
 *
 * O painel fica no cabeçalho pelo mesmo motivo que o botão de voltar: é o único
 * lugar visível nas quatro abas.
 */
export function AppShell() {
  const [tab, setTab] = useState<StudioTab>('wizard');
  const goTo = useCallback((next: StudioTab) => setTab(next), []);

  return (
    <StudioNavigationProvider tab={tab} goTo={goTo}>
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 p-6 antialiased">
        <header className="flex items-center gap-3">
          <BackToHome />
          <h1 className="text-balance text-2xl font-semibold">
            {S.shell.appTitle}
          </h1>
          <div className="ml-auto">
            <QueuePanel />
          </div>
        </header>
        <SmoothTabs
          value={tab}
          onValueChange={(v) => setTab(v as StudioTab)}
          className="flex flex-col gap-4"
        >
          <SmoothTabsList ariaLabel={S.shell.tabsAriaLabel}>
            <SmoothTabsTab value="wizard">{S.shell.tabs.wizard}</SmoothTabsTab>
            <SmoothTabsTab value="poses">{S.shell.tabs.poses}</SmoothTabsTab>
            <SmoothTabsTab value="itens">{S.shell.tabs.itens}</SmoothTabsTab>
            <SmoothTabsTab value="laboratorio">
              {S.shell.tabs.laboratorio}
            </SmoothTabsTab>
          </SmoothTabsList>
          <SmoothTabsPanels className="min-h-96 rounded-lg border border-border bg-card text-card-foreground">
            <SmoothTabsPanel value="wizard" className="p-6">
              <WizardScreen />
            </SmoothTabsPanel>
            <SmoothTabsPanel value="poses" className="p-6">
              <PosesScreen />
            </SmoothTabsPanel>
            <SmoothTabsPanel value="itens" className="p-6">
              <ItensScreen />
            </SmoothTabsPanel>
            <SmoothTabsPanel value="laboratorio" className="p-6">
              <LaboratorioScreen />
            </SmoothTabsPanel>
          </SmoothTabsPanels>
        </SmoothTabs>
      </div>
    </StudioNavigationProvider>
  );
}
