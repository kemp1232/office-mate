"use client";

import Image from "next/image";
import { QRCodeSVG } from "qrcode.react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The single static office QR code. It is only a shortcut to the Attendance page:
 * it does not sign anyone in, prove location, or record attendance.
 */
export function QrPoster({ url }: { url: string }) {
  return (
    <div className="flex flex-col items-center gap-5">
      <article
        aria-label="Printable attendance QR poster"
        className="flex w-full max-w-md flex-col items-center gap-5 rounded-card border border-stroke bg-surface px-6 py-8 text-center print:max-w-none print:break-inside-avoid print:border-0 print:px-0 print:py-0"
      >
        <div className="flex items-center gap-3">
          <Image src="/brand/mark.svg" alt="" width={48} height={48} />
          <div className="text-left leading-tight">
            <p className="text-lg font-bold text-ink-strong">First Mate</p>
            <p className="text-sm text-ink-muted">Attendance</p>
          </div>
        </div>
        <h2 className="text-2xl tracking-tight print:text-4xl">Scan to Clock In / Clock Out</h2>
        <div className="rounded-panel border border-stroke bg-white p-4 print:border-0">
          <QRCodeSVG
            value={url}
            size={256}
            level="M"
            marginSize={2}
            title="Attendance QR code"
            className="h-auto w-[min(64vw,256px)] print:w-[11cm]"
          />
        </div>
        <p className="max-w-xs text-sm text-ink-muted print:max-w-md print:text-base">
          Opens the Attendance app. You&apos;ll sign in if needed, then tap Clock In or Clock Out. Your
          location is checked when you tap.
        </p>
        <p className="text-xs break-all text-ink-muted tabular-nums">{url}</p>
      </article>
      <Button
        onClick={() => window.print()}
        icon={<Printer aria-hidden className="size-5" />}
        className="w-full max-w-md print:hidden"
      >
        Print QR code
      </Button>
    </div>
  );
}
