import { AppProviders } from './app/providers.tsx';
import { AppShell } from './app/shell.tsx';

export function App() {
  return (
    <AppProviders>
      <AppShell />
    </AppProviders>
  );
}
