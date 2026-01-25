 import type { PropsWithChildren } from "react";
 import { useQuery } from "@tanstack/react-query";
import { Navigate, useLocation } from "react-router-dom";
import { useSession } from "@/hooks/useSession";
 import { supabase } from "@/integrations/supabase/client";
 import type { Database } from "@/integrations/supabase/types";
 
 type AppRole = Database["public"]["Enums"]["app_role"];
 
 interface ProtectedRouteProps extends PropsWithChildren {
   requiredRole?: AppRole;
 }

 export function ProtectedRoute({ children, requiredRole }: ProtectedRouteProps) {
  const { user, loading } = useSession();
  const location = useLocation();
   
   const { data: hasRole, isLoading: roleLoading } = useQuery({
     queryKey: ["user-role", user?.id, requiredRole],
     queryFn: async () => {
       if (!user || !requiredRole) return true;
       const { data, error } = await supabase.rpc("has_role", {
         _user_id: user.id,
         _role: requiredRole,
       });
       if (error) throw error;
       return data;
     },
     enabled: !!user && !!requiredRole,
   });

   if (loading || roleLoading) return null;
  if (!user) return <Navigate to="/auth" replace state={{ from: location }} />;
   if (requiredRole && !hasRole) return <Navigate to="/" replace />;
  return <>{children}</>;
}
