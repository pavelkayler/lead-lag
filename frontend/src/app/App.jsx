import { AppProviders } from "./providers/AppProviders";
import { RoutesView } from "./routing/routes";
import "./styles/globals.css";
import "./styles/tokens.css";

export function App() {
  return (
    <AppProviders>
      <RoutesView />
    </AppProviders>
  );
}
