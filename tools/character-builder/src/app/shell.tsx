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

/**
 * Shell do estúdio: cabeçalho + as quatro abas principais.
 * As abas são o smooth-tabs do registry @motion (pill deslizante +
 * crossfade direcional dos painéis), não código próprio.
 *
 * Esta é a tela da rota `#/personagem`. O caminho de volta ao início fica no
 * cabeçalho porque é o único lugar visível nas quatro abas.
 */
export function AppShell() {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 p-6 antialiased">
      <header className="flex items-center gap-3">
        <BackToHome />
        <h1 className="text-balance text-2xl font-semibold">
          {S.shell.appTitle}
        </h1>
      </header>
      <SmoothTabs defaultValue="wizard" className="flex flex-col gap-4">
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
  );
}
