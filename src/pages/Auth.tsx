import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
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
    () => (mode === "login" ? "Entrar" : "Criar conta"),
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
    <div className="min-h-screen bg-background">
      <main className="mx-auto flex w-full max-w-6xl flex-col items-center px-6 py-12">
        <Card className="w-full max-w-md p-6">
          <p className="text-sm text-muted-foreground">Liga do Dino</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Acesse sua conta para confirmar e pagar sua vaga (por enquanto, pagamento simulado).
          </p>

          <Separator className="my-5" />

          <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" {...form.register("email")} />
              {form.formState.errors.email && (
                <p className="text-sm text-destructive">{form.formState.errors.email.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                {...form.register("password")}
              />
              {form.formState.errors.password && (
                <p className="text-sm text-destructive">{form.formState.errors.password.message}</p>
              )}
            </div>

            {message && <p className="text-sm text-muted-foreground">{message}</p>}

            <Button className="w-full" type="submit" disabled={form.formState.isSubmitting}>
              {mode === "login" ? "Entrar" : "Criar conta"}
            </Button>

            <Button
              type="button"
              variant="secondary"
              className="w-full"
              onClick={() => {
                setMessage(null);
                setMode((m) => (m === "login" ? "signup" : "login"));
              }}
            >
              {mode === "login" ? "Não tenho conta" : "Já tenho conta"}
            </Button>
          </form>
        </Card>
      </main>
    </div>
  );
}
