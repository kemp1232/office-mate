"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, LogOut } from "lucide-react";
import { iconButtonClass } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function SignOutButton({ email }: { email: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <button
      type="button"
      // aria-disabled (not disabled) so the spinner isn't faded out while signing out.
      aria-disabled={pending || undefined}
      aria-busy={pending || undefined}
      onClick={async () => {
        if (pending) return;
        setPending(true);
        await authClient.signOut().catch(() => undefined);
        router.replace("/login");
        router.refresh();
      }}
      title={pending ? "Signing out…" : `Sign out (${email})`}
      aria-label={`Sign out ${email}`}
      className={iconButtonClass}
    >
      {pending ? (
        <LoaderCircle aria-hidden className="size-5 animate-spin" />
      ) : (
        <LogOut aria-hidden className="size-5" />
      )}
    </button>
  );
}
