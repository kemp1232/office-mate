"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { MapRef } from "react-map-gl/maplibre";
import { ExternalLink, LocateFixed, MapPin, Save } from "lucide-react";
import { Button, LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { StatusPanel } from "@/components/ui/status-panel";
import { requestBestPosition } from "@/features/attendance/geolocation";
import { saveSettingsAction } from "./actions";
import type { LatLng } from "./office-map";
import { ACCURACY_LIMITS, RADIUS_LIMITS, type AdminSettings, type SettingsFieldErrors } from "./schema";

const OfficeMap = dynamic(() => import("./office-map"), {
  ssr: false,
  loading: () => (
    <div role="status" className="size-full animate-pulse bg-surface-muted">
      <span className="sr-only">Loading map…</span>
    </div>
  ),
});

type Notice = { tone: "success" | "danger" | "warning"; title: string; detail?: string } | null;

const NOTICE_TEXT = { success: "text-success", danger: "text-danger", warning: "text-warning" } as const;
const SAVE_ERROR_TITLE = {
  INVALID_INPUT: "Check the highlighted fields",
  FORBIDDEN: "Only an Admin can change settings",
  SERVER_ERROR: "Couldn't save settings",
} as const;

export function SettingsForm({ initial }: { initial: AdminSettings }) {
  const [saved, setSaved] = useState(initial);
  const [pin, setPin] = useState<LatLng | null>(
    initial.officeLatitude !== null && initial.officeLongitude !== null
      ? { latitude: initial.officeLatitude, longitude: initial.officeLongitude }
      : null,
  );
  const [radius, setRadius] = useState(String(initial.radiusM));
  const [accuracy, setAccuracy] = useState(String(initial.accuracyThresholdM));
  const [reportUrl, setReportUrl] = useState(initial.reportUrl);
  const [errors, setErrors] = useState<SettingsFieldErrors>({});
  const [notice, setNotice] = useState<Notice>(null);
  const [pending, setPending] = useState(false);
  const [locating, setLocating] = useState(false);
  const mapRef = useRef<MapRef | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errors]);

  const radiusNumber = Number(radius);
  const previewRadius = Number.isFinite(radiusNumber) && radiusNumber > 0 ? radiusNumber : initial.radiusM;

  const dirty =
    pin?.latitude !== (saved.officeLatitude ?? undefined) ||
    pin?.longitude !== (saved.officeLongitude ?? undefined) ||
    radius !== String(saved.radiusM) ||
    accuracy !== String(saved.accuracyThresholdM) ||
    reportUrl !== saved.reportUrl;

  async function useMyLocation() {
    setLocating(true);
    // A few readings so a just-woken GPS can settle; the Admin still fine-tunes the pin by hand.
    const result = await requestBestPosition({ targetAccuracyM: 20 });
    setLocating(false);
    if (!result.ok) {
      setNotice({
        tone: "warning",
        title: "Couldn't get your location",
        detail: "Tap the map to place the pin instead.",
      });
      return;
    }
    const next = { latitude: result.position.latitude, longitude: result.position.longitude };
    setPin(next);
    mapRef.current?.flyTo({ center: [next.longitude, next.latitude], zoom: 17 });
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pending || !dirty) return;
    setPending(true);
    setNotice(null);
    try {
      const result = await saveSettingsAction({
        officeLatitude: pin?.latitude ?? null,
        officeLongitude: pin?.longitude ?? null,
        radiusM: radius.trim() === "" ? Number.NaN : Number(radius),
        accuracyThresholdM: accuracy.trim() === "" ? Number.NaN : Number(accuracy),
        reportUrl,
      });
      if (result.ok) {
        setSaved(result.settings);
        setErrors({});
        setNotice({ tone: "success", title: "Settings saved" });
      } else {
        setErrors(result.fieldErrors ?? {});
        setNotice({
          tone: "danger",
          title: SAVE_ERROR_TITLE[result.code],
        });
      }
    } catch {
      setNotice({ tone: "danger", title: "No connection – try again" });
    }
    setPending(false);
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      {!pin ? (
        <StatusPanel
          tone="warning"
          title="Attendance setup incomplete"
          detail="Place the office pin on the map and save. Team Members can't clock in until then."
        />
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-start">
        <Card aria-labelledby="office-heading" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 id="office-heading" className="text-lg">
                Office location
              </h2>
              <p className="text-sm text-ink-muted">Tap the map to drop the pin, then drag to adjust.</p>
            </div>
            <Button
              variant="secondary"
              onClick={useMyLocation}
              disabled={locating}
              icon={<LocateFixed aria-hidden className="size-5" />}
              size="sm"
            >
              {locating ? "Locating…" : "Use my location"}
            </Button>
          </div>
          <div className="relative h-(--height-map) overflow-hidden rounded-panel border border-stroke lg:h-(--height-map-lg)">
            <OfficeMap value={pin} radiusM={previewRadius} onChange={setPin} mapRef={mapRef} />
          </div>
          <p className="flex items-center gap-1.5 text-xs text-ink-muted">
            <MapPin aria-hidden className="size-4 shrink-0" />
            {pin ? (
              <span className="tabular-nums">
                {pin.latitude.toFixed(6)}, {pin.longitude.toFixed(6)}
              </span>
            ) : (
              "No office location set"
            )}
          </p>
          {errors.officeLatitude ? (
            <p role="alert" className="text-sm font-bold text-danger">
              {errors.officeLatitude}
            </p>
          ) : null}
        </Card>

        <div className="flex flex-col gap-5">
          <Card aria-labelledby="geofence-heading" className="flex flex-col gap-5">
            <h2 id="geofence-heading" className="text-lg">
              Geofence
            </h2>
            <Field
              label="Geofence radius"
              name="radiusM"
              type="number"
              inputMode="numeric"
              min={RADIUS_LIMITS.min}
              max={RADIUS_LIMITS.max}
              step={1}
              suffix="m"
              value={radius}
              onChange={(e) => setRadius(e.target.value)}
              hint={`Applied to every Clock In and Clock Out. Default ${RADIUS_LIMITS.default} m.`}
              error={errors.radiusM}
            />
            <Field
              label="GPS accuracy threshold"
              name="accuracyThresholdM"
              type="number"
              inputMode="numeric"
              min={ACCURACY_LIMITS.min}
              max={ACCURACY_LIMITS.max}
              step={1}
              suffix="m"
              value={accuracy}
              onChange={(e) => setAccuracy(e.target.value)}
              hint={`Readings less accurate than this are rejected before the radius check. Default ${ACCURACY_LIMITS.default} m.`}
              error={errors.accuracyThresholdM}
            />
          </Card>

          <Card
            aria-labelledby="report-heading"
            className="flex flex-col gap-4 border-accent/15 bg-accent-tint"
          >
            <h2 id="report-heading" className="text-lg">
              Report link
            </h2>
            <Field
              label="Google Sheet URL"
              name="reportUrl"
              type="url"
              inputMode="url"
              autoCapitalize="none"
              spellCheck={false}
              value={reportUrl}
              onChange={(e) => setReportUrl(e.target.value)}
              hint="Admin-only · not synced with attendance data in v1."
              error={errors.reportUrl}
            />
            <LinkButton
              variant="link"
              size="sm"
              href={saved.reportUrl}
              target="_blank"
              rel="noopener noreferrer"
              icon={<ExternalLink aria-hidden className="size-5" />}
              className="self-start"
            >
              Open report
            </LinkButton>
          </Card>
        </div>
      </div>

      {/* Sticky (in flow), safe-area-aware save bar on phones; inline on desktop. */}
      <div className="sticky bottom-0 z-10 mx-[calc(-1*var(--gutter))] border-t border-stroke bg-surface/95 px-gutter pb-safe backdrop-blur lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
        <div className="mx-auto flex max-w-(--container-admin) flex-col gap-2 py-3 lg:flex-row-reverse lg:items-center lg:justify-start lg:gap-4 lg:py-0">
          <Button
            type="submit"
            aria-disabled={pending || !dirty || undefined}
            icon={<Save aria-hidden className="size-5" />}
            className="w-full lg:w-auto"
          >
            {pending ? "Saving…" : "Save settings"}
          </Button>
          <div role="status" aria-live="polite" className="text-center text-sm lg:text-left">
            {notice ? (
              <span className={`font-bold ${NOTICE_TEXT[notice.tone]}`}>
                {notice.title}
                {notice.detail ? (
                  <span className="block font-medium text-ink-muted">{notice.detail}</span>
                ) : null}
              </span>
            ) : !dirty ? (
              <span className="text-ink-muted">No changes to save</span>
            ) : null}
          </div>
        </div>
      </div>
    </form>
  );
}
