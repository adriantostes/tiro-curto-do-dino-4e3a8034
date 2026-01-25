 import { useQuery } from "@tanstack/react-query";
 import { supabase } from "@/integrations/supabase/client";
 import { Card } from "@/components/ui/card";
 import { Button } from "@/components/ui/button";
 import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
 import { Badge } from "@/components/ui/badge";
 import { CheckCircle, XCircle, Clock, Users, DollarSign } from "lucide-react";
 
 export default function Admin() {
   const { data: payments } = useQuery({
     queryKey: ["admin-payments"],
     queryFn: async () => {
       const { data, error } = await supabase
         .from("payments")
         .select(`
           *,
           payment_items (
             id,
             participant_id,
             round_number,
             participants (
               id,
               team_name,
               cartola_team_id
             )
           )
         `)
         .order("created_at", { ascending: false });
       if (error) throw error;
       return data;
     },
   });
 
   const { data: participants } = useQuery({
     queryKey: ["admin-participants"],
     queryFn: async () => {
       const { data, error } = await supabase
         .from("participants")
         .select("*")
         .order("created_at", { ascending: false });
       if (error) throw error;
       return data;
     },
   });
 
   const statusIcon = (status: string) => {
     switch (status) {
       case "approved":
         return <CheckCircle className="h-4 w-4 text-green-500" />;
       case "pending":
         return <Clock className="h-4 w-4 text-yellow-500" />;
       default:
         return <XCircle className="h-4 w-4 text-red-500" />;
     }
   };
 
   const statusColor = (status: string) => {
     switch (status) {
       case "approved":
         return "bg-green-500/10 text-green-500 border-green-500/20";
       case "pending":
         return "bg-yellow-500/10 text-yellow-500 border-yellow-500/20";
       default:
         return "bg-red-500/10 text-red-500 border-red-500/20";
     }
   };
 
   return (
     <div className="min-h-screen bg-background">
       <main className="mx-auto flex w-full max-w-7xl flex-col px-6 py-12">
         <div className="mb-8">
           <h1 className="text-4xl font-bold tracking-tight">Admin Panel</h1>
           <p className="mt-2 text-muted-foreground">
             Gestão de pagamentos, participantes e auditoria
           </p>
         </div>
 
         <Tabs defaultValue="payments" className="w-full">
           <TabsList className="grid w-full max-w-md grid-cols-2">
             <TabsTrigger value="payments">
               <DollarSign className="mr-2 h-4 w-4" />
               Pagamentos
             </TabsTrigger>
             <TabsTrigger value="participants">
               <Users className="mr-2 h-4 w-4" />
               Participantes
             </TabsTrigger>
           </TabsList>
 
           <TabsContent value="payments" className="mt-6 space-y-4">
             {payments?.map((payment) => (
               <Card key={payment.id} className="p-6">
                 <div className="flex items-start justify-between">
                   <div className="space-y-2">
                     <div className="flex items-center gap-2">
                       <Badge variant="outline" className={statusColor(payment.status)}>
                         <span className="flex items-center gap-1">
                           {statusIcon(payment.status)}
                           {payment.status}
                         </span>
                       </Badge>
                       <span className="text-sm text-muted-foreground">
                         Rodada {payment.round_number}
                       </span>
                     </div>
                     <p className="text-sm text-muted-foreground">
                       ID: {payment.id}
                     </p>
                     <p className="text-sm text-muted-foreground">
                       Transaction: {payment.transaction_id || "N/A"}
                     </p>
                     <p className="text-lg font-semibold">
                       R$ {(payment.amount_cents / 100).toFixed(2)}
                     </p>
                     {payment.payment_items && payment.payment_items.length > 0 && (
                       <div className="mt-3 space-y-1">
                         <p className="text-sm font-medium">Times incluídos:</p>
                         {payment.payment_items.map((item: any) => (
                           <p key={item.id} className="text-sm text-muted-foreground">
                             • {item.participants?.team_name} (ID: {item.participants?.cartola_team_id})
                           </p>
                         ))}
                       </div>
                     )}
                   </div>
                   <div className="text-right text-sm text-muted-foreground">
                     {new Date(payment.created_at).toLocaleDateString("pt-BR", {
                       day: "2-digit",
                       month: "2-digit",
                       year: "numeric",
                       hour: "2-digit",
                       minute: "2-digit",
                     })}
                   </div>
                 </div>
               </Card>
             ))}
             {!payments?.length && (
               <Card className="p-12 text-center">
                 <p className="text-muted-foreground">Nenhum pagamento encontrado</p>
               </Card>
             )}
           </TabsContent>
 
           <TabsContent value="participants" className="mt-6 space-y-4">
             {participants?.map((participant) => (
               <Card key={participant.id} className="p-6">
                 <div className="flex items-start justify-between">
                   <div className="space-y-1">
                     <p className="font-semibold">{participant.team_name}</p>
                     <p className="text-sm text-muted-foreground">
                       Cartola ID: {participant.cartola_team_id}
                     </p>
                     <p className="text-sm text-muted-foreground">
                       User ID: {participant.user_id}
                     </p>
                   </div>
                   <div className="text-right text-sm text-muted-foreground">
                     {new Date(participant.created_at).toLocaleDateString("pt-BR", {
                       day: "2-digit",
                       month: "2-digit",
                       year: "numeric",
                     })}
                   </div>
                 </div>
               </Card>
             ))}
             {!participants?.length && (
               <Card className="p-12 text-center">
                 <p className="text-muted-foreground">Nenhum participante encontrado</p>
               </Card>
             )}
           </TabsContent>
         </Tabs>
       </main>
     </div>
   );
 }