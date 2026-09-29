import "server-only";
import { JWT } from "google-auth-library";
import { a1, SHEET_HEADER } from "./format";

/**
 * Minimal Google Sheets API client (REST v4) for one-way attendance export.
 * Only the calls the sync needs; everything is scoped to one spreadsheet id.
 */
export type SheetsApi = {
  /** Makes sure a tab with this title exists (created first in the tab bar, with a header row). */
  ensureTab(spreadsheetId: string, title: string): Promise<void>;
  /** Emails in column B (row 2 onwards) of a tab. */
  readEmails(spreadsheetId: string, title: string): Promise<string[]>;
  writeRow(spreadsheetId: string, title: string, rowNumber: number, values: string[]): Promise<void>;
  appendRow(spreadsheetId: string, title: string, values: string[]): Promise<void>;
};

const BASE = "https://sheets.googleapis.com/v4/spreadsheets";

export class SheetsError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function createSheetsApi(opts: {
  getAccessToken: () => Promise<string>;
  fetch?: typeof fetch;
}): SheetsApi {
  const doFetch = opts.fetch ?? fetch;

  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await doFetch(`${BASE}/${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${await opts.getAccessToken()}`,
        "content-type": "application/json",
        ...init.headers,
      },
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      throw new SheetsError(
        body?.error?.message ?? `Google Sheets request failed (${res.status})`,
        res.status,
      );
    }
    return (await res.json()) as T;
  }

  const values = (id: string, range: string) =>
    `${encodeURIComponent(id)}/values/${encodeURIComponent(range)}`;

  return {
    async ensureTab(spreadsheetId, title) {
      const meta = await call<{ sheets?: { properties: { title: string } }[] }>(
        `${encodeURIComponent(spreadsheetId)}?fields=sheets.properties.title`,
      );
      if (meta.sheets?.some((s) => s.properties.title === title)) return;
      try {
        await call(`${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
          method: "POST",
          body: JSON.stringify({
            requests: [
              {
                addSheet: {
                  properties: { title, index: 0, gridProperties: { frozenRowCount: 1, columnCount: 4 } },
                },
              },
            ],
          }),
        });
      } catch (error) {
        // Another worker created it a moment ago — that's fine.
        if (!(error instanceof SheetsError && /already exists/i.test(error.message))) throw error;
        return;
      }
      await call(`${values(spreadsheetId, a1(title, "A1:D1"))}?valueInputOption=RAW`, {
        method: "PUT",
        body: JSON.stringify({ values: [SHEET_HEADER] }),
      });
    },

    async readEmails(spreadsheetId, title) {
      const res = await call<{ values?: string[][] }>(values(spreadsheetId, a1(title, "B2:B")));
      return (res.values ?? []).map((row) => (row[0] ?? "").trim().toLowerCase());
    },

    async writeRow(spreadsheetId, title, rowNumber, rowValues) {
      await call(`${values(spreadsheetId, a1(title, `A${rowNumber}:D${rowNumber}`))}?valueInputOption=RAW`, {
        method: "PUT",
        body: JSON.stringify({ values: [rowValues] }),
      });
    },

    async appendRow(spreadsheetId, title, rowValues) {
      await call(
        `${values(spreadsheetId, a1(title, "A:D"))}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        { method: "POST", body: JSON.stringify({ values: [rowValues] }) },
      );
    },
  };
}

/** Service-account credentials → access tokens (cached and refreshed by google-auth-library). */
export function serviceAccountTokens(email: string, privateKey: string) {
  const jwt = new JWT({
    email,
    key: privateKey.replace(/\\n/g, "\n"), // env vars usually carry the PEM with escaped newlines
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return async () => {
    const { token } = await jwt.getAccessToken();
    if (!token) throw new Error("Google did not return an access token");
    return token;
  };
}
