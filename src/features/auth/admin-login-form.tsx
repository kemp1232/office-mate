"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage } from "./auth-errors";

/** Email + password sign-in — the Admin account only (the server refuses other addresses). */
export function AdminLoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(undefined);
    try {
      const { error: authError } = await authClient.signIn.email({
        email: String(form.get("email") ?? "").trim(),
        password: String(form.get("password") ?? ""),
      });
      if (authError) {
        setError(authErrorMessage(authError));
        setPending(false);
        return;
      }
      router.replace(next);
      router.refresh();
    } catch {
      setError(authErrorMessage({ status: 0 }));
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Field
        label="Admin email"
        name="email"
        type="email"
        autoComplete="username"
        inputMode="email"
        autoCapitalize="none"
        spellCheck={false}
        placeholder="admin@firstmate.tech"
        required
      />
      <Field label="Password" name="password" type="password" autoComplete="current-password" required />
      <p role="alert" className="text-sm font-bold text-danger empty:hidden">
        {error}
      </p>
      <Button
        type="submit"
        aria-disabled={pending || undefined}
        icon={<LogIn aria-hidden className="size-5" />}
        className="mt-1 w-full"
      >
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
