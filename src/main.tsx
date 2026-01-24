import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { ThemeProvider } from "./providers/ThemeProvider";

// Hide page scrollbars while keeping scrolling (mobile friendly)
document.documentElement.classList.add("no-scrollbar");
document.body.classList.add("no-scrollbar");

createRoot(document.getElementById("root")!).render(
  <ThemeProvider>
    <App />
  </ThemeProvider>,
);
