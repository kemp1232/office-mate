/** Maps Better Auth errors to plain-language messages. */
export type AuthClientError = { code?: string; status?: number; message?: string } | null | undefined;

/** Errors from the Admin email + password form. */
export function authErrorMessage(error: AuthClientError): string {
  if (typeof navigator !== "undefined" && !navigator.onLine) return "No connection – try again.";
  if (!error) return "Something went wrong. Please try again.";
  if (error.status === 429) return "Too many attempts. Wait a minute, then try again.";
  switch (error.code) {
    case "INVALID_EMAIL_OR_PASSWORD":
      return "That email and password don't match.";
    case "USE_GOOGLE_SIGN_IN":
      return "Team Members sign in with Google, not a password.";
    case "INVALID_EMAIL":
      return "Enter a valid email address.";
    default:
      return error.status === 0 || error.status === undefined
        ? "No connection – try again."
        : "Something went wrong. Please try again.";
  }
}

/** Errors Better Auth appends as `?error=` when the Google sign-in round trip fails. */
export function googleErrorMessage(code: string | undefined): string | undefined {
  if (!code) return undefined;
  switch (code) {
    case "EMAIL_DOMAIN_NOT_ALLOWED":
    case "unable_to_get_user_info": // Google account isn't in the firstmate.tech Workspace (hd check)
    case "unable_to_create_user":
      return "Use your @firstmate.tech Google Workspace account.";
    case "account_not_linked":
      return "This account signs in with email and password — use Admin sign in.";
    case "access_denied":
      return "Google sign-in was cancelled.";
    default:
      return "Google sign-in didn't complete. Please try again.";
  }
}
