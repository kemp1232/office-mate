"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { Button, LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { saveMemberAction } from "./actions";
import { REQUIRED_HOURS, type MemberFieldErrors, type MemberFormValues, type RuleMode } from "./schema";

const RULES: { mode: RuleMode; label: string; detail: string }[] = [
  { mode: "NONE", label: "No rule", detail: "They can clock out any time." },
  {
    mode: "TIME",
    label: "Fixed Clock Out time",
    detail: "They can clock out from this time each office day.",
  },
  { mode: "HOURS", label: "Required hours", detail: "They can clock out once they've been in this long." },
];

const SAVE_ERRORS = {
  FORBIDDEN: "Only the Admin can change team members.",
  NOT_FOUND: "This team member no longer exists.",
  SERVER_ERROR: "Couldn't save. Try again.",
  INVALID_INPUT: "Check the highlighted fields.",
} as const;

/** Add or edit a team member: names, email, and their Clock Out rule. */
export function MemberForm({
  initial,
  signedIn,
  timezone,
}: {
  initial: MemberFormValues;
  signedIn: boolean;
  timezone: string;
}) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<MemberFieldErrors>({});
  const [formError, setFormError] = useState<string>();
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const isNew = initial.id === null;

  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errors]);

  // Editing a field clears its error, so a fixed value never sits next to a stale message.
  const set = (key: keyof MemberFormValues) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setValues((v) => ({ ...v, [key]: e.target.value }));
    setErrors((errs) => (key in errs ? { ...errs, [key]: undefined } : errs));
  };

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setFormError(undefined);
    try {
      const result = await saveMemberAction(values);
      if (result.ok) {
        router.push(`/admin/team?saved=${result.id}`);
        return;
      }
      setErrors(result.fieldErrors ?? {});
      setFormError(SAVE_ERRORS[result.code]);
    } catch {
      setFormError("You're offline. Check your connection and try again.");
    }
    setPending(false);
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <Card aria-labelledby="details-heading" className="flex flex-col gap-5">
        <h2 id="details-heading" className="text-lg">
          Details
        </h2>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label="First name"
            name="firstName"
            autoComplete="off"
            value={values.firstName}
            onChange={set("firstName")}
            error={errors.firstName}
          />
          <Field
            label="Last name"
            name="lastName"
            autoComplete="off"
            value={values.lastName}
            onChange={set("lastName")}
            error={errors.lastName}
          />
        </div>
        <Field
          label="Email"
          name="email"
          type="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          autoComplete="off"
          value={values.email}
          onChange={set("email")}
          readOnly={signedIn}
          hint={
            signedIn
              ? "They've signed in with this Google account, so the email can't change."
              : "Their @firstmate.tech Google account. They'll sign in with Google using this email."
          }
          error={errors.email}
          className={signedIn ? "[&_input]:bg-surface-muted [&_input]:text-ink-muted" : ""}
        />
      </Card>

      <Card aria-labelledby="rule-heading" className="flex flex-col gap-4">
        <div>
          <h2 id="rule-heading" className="text-lg">
            Clock Out rule
          </h2>
          <p className="text-sm text-ink-muted">
            The same every office day. You can still lock or unlock their Clock Out for a day from the Team
            page.
          </p>
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">Clock Out rule</legend>
          {RULES.map((rule) => (
            // The whole card is the radio (it sits invisibly on top); the dot is drawn beside the text.
            <label
              key={rule.mode}
              className="relative flex cursor-pointer items-start gap-3 rounded-panel border border-line px-4 py-3 transition-colors duration-(--duration-base) has-checked:border-accent has-checked:bg-accent-tint has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent"
            >
              <input
                type="radio"
                name="ruleMode"
                value={rule.mode}
                checked={values.ruleMode === rule.mode}
                onChange={() => setValues((v) => ({ ...v, ruleMode: rule.mode }))}
                className="peer absolute inset-0 size-full cursor-pointer opacity-0"
              />
              <span
                aria-hidden
                className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2 border-line-strong bg-surface transition-colors duration-(--duration-base) peer-checked:border-accent after:size-2.5 after:rounded-full after:bg-accent after:opacity-0 peer-checked:after:opacity-100"
              />
              <span>
                <span className="block font-bold text-ink-strong">{rule.label}</span>
                <span className="block text-sm text-ink-muted">{rule.detail}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {values.ruleMode === "TIME" ? (
          <Field
            label="Clock Out from"
            name="clockOutTime"
            type="time"
            step={60}
            value={values.clockOutTime}
            onChange={set("clockOutTime")}
            hint={`Office time (${timezone}). If they clock in after this, they can clock out right away.`}
            error={errors.clockOutTime}
            className="sm:max-w-xs"
          />
        ) : null}
        {values.ruleMode === "HOURS" ? (
          <Field
            label="Required hours"
            name="requiredHours"
            type="number"
            inputMode="decimal"
            min={REQUIRED_HOURS.min}
            max={REQUIRED_HOURS.max}
            step={REQUIRED_HOURS.step}
            suffix="h"
            value={values.requiredHours}
            onChange={set("requiredHours")}
            hint="Counted from their Clock In, breaks included. For example 9 or 8.5."
            error={errors.requiredHours}
            className="sm:max-w-xs"
          />
        ) : null}
      </Card>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
        <p role="status" aria-live="polite" className="text-sm font-bold text-danger empty:hidden sm:mr-auto">
          {formError}
        </p>
        <LinkButton variant="secondary" href="/admin/team">
          Cancel
        </LinkButton>
        <Button
          type="submit"
          aria-disabled={pending || undefined}
          icon={<Save aria-hidden className="size-5" />}
        >
          {pending ? "Saving…" : isNew ? "Add member" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
