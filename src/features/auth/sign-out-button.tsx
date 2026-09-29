"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { iconButtonClass } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function SignOutButton({ email }: { email: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <button
      type="button"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await authClient.signOut().catch(() => undefined);
        router.replace("/login");
        router.refresh();
      }}
      title={`Sign out (${email})`}
      aria-label={`Sign out ${email}`}
      className={iconButtonClass}
    >
      <LogOut aria-hidden className="size-5" />
    </button>
  );
}
