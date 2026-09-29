"use client";

import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusPanel } from "@/components/ui/status-panel";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="flex min-h-dvh items-center justify-center pt-safe px-gutter pb-safe">
      <div className="flex w-full max-w-(--container-attendance) flex-col gap-4">
        <StatusPanel
          tone="danger"
          title="Something went wrong"
          detail="Nothing was recorded. Check your connection and try again."
        />
        <Button onClick={reset} icon={<RotateCw aria-hidden className="size-5" />} className="w-full">
          Try again
        </Button>
      </div>
    </main>
  );
}
