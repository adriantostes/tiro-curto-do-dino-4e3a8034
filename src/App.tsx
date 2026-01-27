import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import Ranking from "./pages/Ranking";
import Auth from "./pages/Auth";
 import Admin from "./pages/Admin";
 import { ProtectedRoute } from "./components/ProtectedRoute";
import { BuildStamp } from "./components/BuildStamp";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/auth" element={<Auth />} />
          <Route path="/ranking" element={<Ranking />} />
           <Route
             path="/admin"
             element={
               <ProtectedRoute requiredRole="admin">
                 <Admin />
               </ProtectedRoute>
             }
           />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
         <BuildStamp />
      </TooltipProvider>
    </BrowserRouter>
  </QueryClientProvider>
);

export default App;
