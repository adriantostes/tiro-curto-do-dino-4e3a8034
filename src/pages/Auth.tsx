import { useMemo, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

const schema = z.object({
  email: z.string().email("Email inválido"),
  password: z.string().min(6, "Mínimo de 6 caracteres"),
});
type FormValues = z.infer<typeof schema>;

export default function Auth() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [message, setMessage] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  const title = useMemo(
    () => (mode === "login" ? "ENTRAR" : "CRIAR CONTA"),
    [mode]
  );

  async function onSubmit(values: FormValues) {
    setMessage(null);
    const redirectUrl = `${window.location.origin}/`;

    if (mode === "signup") {
      const { error } = await supabase.auth.signUp({
        email: values.email,
        password: values.password,
        options: { emailRedirectTo: redirectUrl },
      });
      if (error) return setMessage(error.message);
      setMessage("Conta criada. Você já pode entrar.");
      setMode("login");
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({
      email: values.email,
      password: values.password,
    });
    if (error) return setMessage(error.message);
    navigate("/", { replace: true });
  }

  return (
    <div className="min-h-screen bg-[#060606] text-white font-sans flex items-center justify-center p-4">
      <div className="w-full max-w-md animate-enter">
        <div className="flex justify-center mb-8">
          <Link to="/" className="flex items-center gap-2 group">
            <div className="relative h-12 w-12 bg-primary flex items-center justify-center rounded-br-2xl rounded-tl-2xl transform -skew-x-12 shadow-[0_0_30px_rgba(34,197,94,0.4)]">
              <svg viewBox="0 0 24 24" className="h-8 w-8 text-black fill-current transform skew-x-12" xmlns="http://www.w3.org/2000/svg">
                <path d="M22,10V6.5c0-1.93-1.57-3.5-3.5-3.5H5.5C3.57,3,2,4.57,2,6.5V10c1.1,0,2,0.9,2,2s-0.9,2-2,2v3.5c0,1.93,1.57,3.5,3.5,3.5h13 c1.93,0,3.5-1.57,3.5-3.5V14c-1.1,0-2-0.9-2-2S20.9,10,22,10z M11,17h-2v-2h2V17z M11,13h-2v-2h2V13z M11,9h-2V7h2V9z M16,17h-2v-2h2 V17z M16,13h-2v-2h2V13z M16,9h-2V7h2V9z"/>
              </svg>
            </div>
            <div className="flex flex-col leading-none">
              <span className="text-sm font-black italic tracking-tight text-white/90">MELHOR DA</span>
              <span className="text-sm font-black italic tracking-tight text-primary">RODADA DO DINO</span>
            </div>
          </Link>
        </div>

        <Card className="bg-[#121212] border-white/5 p-8 shadow-2xl relative overflow-hidden">
          {/* Accent glow */}
          <div className="absolute top-0 right-0 -mt-10 -mr-10 h-32 w-32 bg-primary/10 blur-[50px] rounded-full" />
          
          <div className="relative">
            <h1 className="text-3xl font-black italic uppercase tracking-tighter mb-2">{title}</h1>
            <p className="text-xs font-bold text-gray-500 uppercase tracking-tight mb-8">
              Acesse sua conta para confirmar e pagar sua vaga na liga.
            </p>

            <form className="space-y-6" onSubmit={form.handleSubmit(onSubmit)}>
              <div className="space-y-2">
                <Label htmlFor="email" className="text-[10px] font-black uppercase tracking-widest text-gray-500">EMAIL</Label>
                <Input 
                  id="email" 
                  type="email" 
                  placeholder="seu@email.com"
                  className="bg-black/50 border-white/10 h-12 focus:border-primary/50 transition-all font-bold"
                  {...form.register("email")} 
                />
                {form.formState.errors.email && (
                  <p className="text-[10px] font-bold text-red-500 uppercase italic">{form.formState.errors.email.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-[10px] font-black uppercase tracking-widest text-gray-500">SENHA</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  className="bg-black/50 border-white/10 h-12 focus:border-primary/50 transition-all font-bold"
                  {...form.register("password")}
                />
                {form.formState.errors.password && (
                  <p className="text-[10px] font-bold text-red-500 uppercase italic">{form.formState.errors.password.message}</p>
                )}
              </div>

              {message && (
                <div className="bg-primary/5 border border-primary/20 p-3 rounded-lg">
                  <p className="text-[10px] font-bold text-primary uppercase text-center italic">{message}</p>
                </div>
              )}

              <div className="space-y-4 pt-2">
                <Button 
                  className="w-full bg-primary text-black font-black hover:bg-primary/90 h-14 uppercase italic tracking-widest shadow-[0_0_20px_rgba(34,197,94,0.3)]" 
                  type="submit" 
                  disabled={form.formState.isSubmitting}
                >
                  {form.formState.isSubmitting ? "PROCESSANDO..." : title}
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  className="w-full text-xs font-bold text-gray-500 hover:text-white uppercase tracking-widest"
                  onClick={() => {
                    setMessage(null);
                    setMode((m) => (m === "login" ? "signup" : "login"));
                  }}
                >
                  {mode === "login" ? "NÃO TENHO CONTA • CRIAR" : "JÁ TENHO CONTA • ENTRAR"}
                </Button>
              </div>
            </form>

            <Separator className="my-8 bg-white/5" />

            <Button
              variant="ghost"
              asChild
              className="w-full text-[10px] font-black text-gray-700 hover:text-gray-400 uppercase tracking-[0.3em]"
            >
              <Link to="/">← VOLTAR PARA O INÍCIO</Link>
            </Button>
          </div>
        </Card>
        
        <p className="mt-8 text-center text-[10px] font-black uppercase text-gray-800 tracking-[0.4em]">
          © 2026 LIGA DO DINO SERVICES
        </p>
      </div>
    </div>
  );
}
