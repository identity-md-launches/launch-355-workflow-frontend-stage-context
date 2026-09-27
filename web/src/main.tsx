import React from "react";
import { createRoot } from "react-dom/client";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { loadDeployment } from "./config";
import { App } from "./App";
import "./style.css";
const root = createRoot(document.getElementById("root")!);
loadDeployment()
  .then((runtime) =>
    root.render(
      <React.StrictMode>
        <WagmiProvider config={runtime.wagmi}>
          <QueryClientProvider client={new QueryClient()}>
            <App r={runtime} />
          </QueryClientProvider>
        </WagmiProvider>
      </React.StrictMode>,
    ),
  )
  .catch((e) =>
    root.render(
      <main className="fatal">
        <h1>Deployment unavailable</h1>
        <p role="alert">{String(e.message)}</p>
        <button onClick={() => location.reload()}>Reload deployment</button>
      </main>,
    ),
  );
