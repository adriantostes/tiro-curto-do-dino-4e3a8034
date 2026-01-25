 import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
 
 const corsHeaders = {
   "Access-Control-Allow-Origin": "*",
   "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
 };
 
 interface AddParticipantRequest {
   cartola_team_id: number;
   team_name: string;
   team_slug?: string;
   team_shield_url?: string;
   user_email: string;
   league_id?: string;
 }
 
 Deno.serve(async (req) => {
   if (req.method === "OPTIONS") {
     return new Response(null, { headers: corsHeaders });
   }
 
   try {
     const authHeader = req.headers.get("Authorization");
     if (!authHeader?.startsWith("Bearer ")) {
       return new Response(
         JSON.stringify({ error: "Unauthorized" }),
         { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
       );
     }
 
     const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
     const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
     const supabase = createClient(supabaseUrl, supabaseKey, {
       global: { headers: { Authorization: authHeader } },
     });
 
     const token = authHeader.replace("Bearer ", "");
     const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
     if (claimsError || !claimsData?.claims?.sub) {
       console.error("Claims error:", claimsError);
       return new Response(
         JSON.stringify({ error: "Unauthorized" }),
         { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
       );
     }
 
     // Verify admin role
     const adminClient = createClient(
       supabaseUrl,
       Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
     );
     
     const { data: isAdmin } = await adminClient.rpc("has_role", {
       _user_id: claimsData.claims.sub,
       _role: "admin",
     });
 
     if (!isAdmin) {
       console.log("User is not admin:", claimsData.claims.sub);
       return new Response(
         JSON.stringify({ error: "Forbidden - Admin only" }),
         { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
       );
     }
 
     const body: AddParticipantRequest = await req.json();
     console.log("Admin adding participant:", body);
 
     // Find user by email
     const { data: userData, error: userError } = await adminClient.auth.admin.listUsers();
     if (userError) {
       console.error("Error listing users:", userError);
       return new Response(
         JSON.stringify({ error: "Failed to find user" }),
         { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
       );
     }
 
     const targetUser = userData.users.find((u) => u.email === body.user_email);
     if (!targetUser) {
       return new Response(
         JSON.stringify({ error: `User not found: ${body.user_email}` }),
         { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
       );
     }
 
     // Check if participant already exists
     const { data: existing } = await adminClient
       .from("participants")
       .select("id")
       .eq("cartola_team_id", body.cartola_team_id)
       .eq("user_id", targetUser.id)
       .single();
 
     if (existing) {
       return new Response(
         JSON.stringify({ error: "Participant already exists" }),
         { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
       );
     }
 
     // Insert participant
     const { data: participant, error: insertError } = await adminClient
       .from("participants")
       .insert({
         cartola_team_id: body.cartola_team_id,
         team_name: body.team_name,
         team_slug: body.team_slug,
         team_shield_url: body.team_shield_url,
         user_id: targetUser.id,
         league_id: body.league_id || null,
       })
       .select()
       .single();
 
     if (insertError) {
       console.error("Error inserting participant:", insertError);
       return new Response(
         JSON.stringify({ error: insertError.message }),
         { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
       );
     }
 
     console.log("Participant added successfully:", participant.id);
     return new Response(
       JSON.stringify({ success: true, participant }),
       { headers: { ...corsHeaders, "Content-Type": "application/json" } }
     );
   } catch (error: unknown) {
     console.error("Unexpected error:", error);
     const errorMessage = error instanceof Error ? error.message : "Unknown error";
     return new Response(
       JSON.stringify({ error: errorMessage }),
       { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
     );
   }
 });