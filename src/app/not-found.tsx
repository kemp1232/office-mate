import { LinkButton } from "@/components/ui/button";
import { StatusPanel } from "@/components/ui/status-panel";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center pt-safe px-gutter pb-safe">
      <div className="flex w-full max-w-(--container-attendance) flex-col gap-4">
        <StatusPanel tone="neutral" title="Page not found" />
        <LinkButton href="/attendance" className="w-full">
          Go to Attendance
        </LinkButton>
      </div>
    </main>
  );
}
