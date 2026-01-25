 import { useQuery } from "@tanstack/react-query";
 import { useState } from "react";
 import { supabase } from "@/integrations/supabase/client";
 import { Card } from "@/components/ui/card";
 import { Button } from "@/components/ui/button";
 import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
 import { Badge } from "@/components/ui/badge";
 import { Input } from "@/components/ui/input";
 import { Label } from "@/components/ui/label";
 import { CheckCircle, XCircle, Clock, Users, DollarSign, UserPlus } from "lucide-react";
 import { toast } from "sonner";
 import { cartolaSearchTeams } from "@/lib/cartola";
 
 export default function Admin() {
   const [searchId, setSearchId] = useState("");
   const [userEmail, setUserEmail] = useState("");
   const [teamData, setTeamData] = useState<any>(null);
   const [isSearching, setIsSearching] = useState(false);
   const [isAdding, setIsAdding] = useState(false);
 
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
         return <CheckCircle className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />;
       case "pending":
         return <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" />;
       default:
         return <XCircle className="h-4 w-4 text-destructive" />;
     }
   };
 
   const statusColor = (status: string) => {
     switch (status) {
       case "approved":
         return "bg-green-100 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-300 dark:border-green-800";
       case "pending":
         return "bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-900/20 dark:text-yellow-300 dark:border-yellow-800";
       default:
         return "bg-destructive/10 text-destructive border-destructive/20";
     }
   };
 
   const handleSearchTeam = async () => {
     if (!searchId) {
       toast.error("Digite o ID do time");
       return;
     }
     
     setIsSearching(true);
     try {
       const results = await cartolaSearchTeams(searchId);
       if (results && results.length > 0) {
         setTeamData(results[0]);
         toast.success("Time encontrado!");
       } else {
         toast.error("Time não encontrado");
         setTeamData(null);
       }
     } catch (error) {
       console.error("Error searching team:", error);
       toast.error("Erro ao buscar time");
       setTeamData(null);
     } finally {
       setIsSearching(false);
     }
   };
 
   const handleAddParticipant = async () => {
     if (!teamData || !userEmail) {
       toast.error("Preencha todos os campos");
       return;
     }
 
     setIsAdding(true);
     try {
       const { data: sessionData } = await supabase.auth.getSession();
       const token = sessionData.session?.access_token;
 
       const response = await supabase.functions.invoke("admin-add-participant", {
         body: {
           cartola_team_id: teamData.time_id,
           team_name: teamData.nome,
           team_slug: teamData.slug,
           team_shield_url: teamData.url_escudo_png,
           user_email: userEmail,
         },
       });
 
       if (response.error) {
         throw response.error;
       }
 
       toast.success("Participante adicionado com sucesso!");
       setTeamData(null);
       setSearchId("");
       setUserEmail("");
     } catch (error: any) {
       console.error("Error adding participant:", error);
       toast.error(error.message || "Erro ao adicionar participante");
     } finally {
       setIsAdding(false);
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
           <TabsList className="grid w-full max-w-2xl grid-cols-3">
             <TabsTrigger value="payments">
               <DollarSign className="mr-2 h-4 w-4" />
               Pagamentos
             </TabsTrigger>
             <TabsTrigger value="participants">
               <Users className="mr-2 h-4 w-4" />
               Participantes
             </TabsTrigger>
             <TabsTrigger value="add">
               <UserPlus className="mr-2 h-4 w-4" />
               Adicionar Time
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

           <TabsContent value="add" className="mt-6 space-y-6">
             <Card className="p-6">
               <h2 className="text-xl font-semibold mb-4">Adicionar Participante Manualmente</h2>
               <p className="text-sm text-muted-foreground mb-6">
                 Use esta ferramenta para adicionar times manualmente em caso de bugs ou situações especiais.
               </p>
               
               <div className="space-y-4">
                 <div className="grid gap-4 sm:grid-cols-2">
                   <div className="space-y-2">
                     <Label htmlFor="team-id">ID do Time (Cartola)</Label>
                     <Input
                       id="team-id"
                       type="number"
                       placeholder="Ex: 12345678"
                       value={searchId}
                       onChange={(e) => setSearchId(e.target.value)}
                     />
                   </div>
                   
                   <div className="space-y-2">
                     <Label htmlFor="user-email">Email do Usuário</Label>
                     <Input
                       id="user-email"
                       type="email"
                       placeholder="usuario@exemplo.com"
                       value={userEmail}
                       onChange={(e) => setUserEmail(e.target.value)}
                     />
                   </div>
                 </div>
                 
                 <Button onClick={handleSearchTeam} disabled={isSearching || !searchId}>
                   {isSearching ? "Buscando..." : "Buscar Time"}
                 </Button>
               </div>
 
               {teamData && (
                 <div className="mt-6 p-4 border rounded-lg space-y-3">
                   <div className="flex items-center gap-3">
                     {teamData.url_escudo_png && (
                       <img
                         src={teamData.url_escudo_png}
                         alt={teamData.nome}
                         className="h-12 w-12 rounded"
                       />
                     )}
                     <div>
                       <p className="font-semibold">{teamData.nome}</p>
                       <p className="text-sm text-muted-foreground">ID: {teamData.time_id}</p>
                       {teamData.slug && (
                         <p className="text-sm text-muted-foreground">Slug: {teamData.slug}</p>
                       )}
                     </div>
                   </div>
                   
                   <Button onClick={handleAddParticipant} disabled={isAdding || !userEmail} className="w-full">
                     {isAdding ? "Adicionando..." : "Confirmar e Adicionar"}
                   </Button>
                 </div>
               )}
             </Card>
           </TabsContent>
         </Tabs>
       </main>
     </div>
   );
 }