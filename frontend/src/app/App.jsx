import { AppProviders } from "./providers/AppProviders";
import { Routes } from "./routing/routes";
import "./styles/globals.css";
import "./styles/tokens.css";

export function App() {
  return (
    <AppProviders>
      <Routes />
    </AppProviders>
  );
}
