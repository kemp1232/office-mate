import { describe, expect, it, vi } from "vitest";
import { createSheetsApi } from "@/features/sheets/client";
import { a1, rowValues, spreadsheetIdFromUrl, tabTitle } from "@/features/sheets/format";

vi.mock("server-only", () => ({}));

describe("sheet formatting", () => {
  it("reads the spreadsheet id from the Admin's report link", () => {
    expect(
      spreadsheetIdFromUrl(
        "https://docs.google.com/spreadsheets/d/1aaFxa0_6wPRFo4h1p6BoYmnWQu1Ko6OB03XFdQqlWME/edit?usp=sharing",
      ),
    ).toBe("1aaFxa0_6wPRFo4h1p6BoYmnWQu1Ko6OB03XFdQqlWME");
    expect(
      spreadsheetIdFromUrl("https://example.com/spreadsheets/d/1aaFxa0_6wPRFo4h1p6BoYmnWQu1Ko6OB03XFdQqlWME"),
    ).toBeNull();
    expect(spreadsheetIdFromUrl("https://docs.google.com/document/d/abc/edit")).toBeNull();
    expect(spreadsheetIdFromUrl("not a url")).toBeNull();
  });

  it("names each office-day tab like 'October 13, 2026'", () => {
    expect(tabTitle("2026-10-13")).toBe("October 13, 2026");
    expect(tabTitle("2026-09-10")).toBe("September 10, 2026");
    expect(tabTitle("2027-01-01")).toBe("January 1, 2027");
  });

  it("quotes tab names in A1 ranges", () => {
    expect(a1("October 13, 2026", "A1:D1")).toBe("'October 13, 2026'!A1:D1");
    expect(a1("Bob's day", "B2:B")).toBe("'Bob''s day'!B2:B");
  });

  it("writes Name, Email, Time in, Time out in the org timezone", () => {
    const person = {
      name: "Jane Doe",
      email: "jane@firstmate.tech",
      clockIn: "2026-10-13T01:04:00Z",
      clockOut: null,
    };
    expect(rowValues(person, "Asia/Manila")).toEqual(["Jane Doe", "jane@firstmate.tech", "09:04", ""]);
    expect(rowValues({ ...person, clockOut: "2026-10-13T09:32:00Z" }, "Asia/Manila")[3]).toBe("17:32");
  });
});

describe("Google Sheets client", () => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("creates a missing day tab (first, frozen header) and writes the header row", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json({ sheets: [{ properties: { title: "September 10, 2026" } }] }))
      .mockResolvedValueOnce(json({}))
      .mockResolvedValueOnce(json({}));
    const api = createSheetsApi({ getAccessToken: async () => "token", fetch });
    await api.ensureTab("sheet-id", "October 13, 2026");

    expect(fetch).toHaveBeenCalledTimes(3);
    const [, addCall, headerCall] = fetch.mock.calls;
    expect(addCall[0]).toContain("sheet-id:batchUpdate");
    expect(JSON.parse(addCall[1].body).requests[0].addSheet.properties).toMatchObject({
      title: "October 13, 2026",
      index: 0,
      gridProperties: { frozenRowCount: 1 },
    });
    expect(decodeURIComponent(headerCall[0])).toContain("'October 13, 2026'!A1:D1");
    expect(JSON.parse(headerCall[1].body).values).toEqual([["Name", "Email", "Time in", "Time out"]]);
    expect(addCall[1].headers.authorization).toBe("Bearer token");
  });

  it("leaves an existing tab alone and tolerates a concurrent create", async () => {
    const existing = vi
      .fn()
      .mockResolvedValue(json({ sheets: [{ properties: { title: "October 13, 2026" } }] }));
    await createSheetsApi({ getAccessToken: async () => "t", fetch: existing }).ensureTab(
      "id",
      "October 13, 2026",
    );
    expect(existing).toHaveBeenCalledTimes(1);

    const race = vi
      .fn()
      .mockResolvedValueOnce(json({ sheets: [] }))
      .mockResolvedValueOnce(
        json({ error: { message: 'A sheet with the name "October 13, 2026" already exists.' } }, 400),
      );
    await expect(
      createSheetsApi({ getAccessToken: async () => "t", fetch: race }).ensureTab("id", "October 13, 2026"),
    ).resolves.toBeUndefined();
  });

  it("surfaces Google errors (e.g. the Sheet isn't shared with the service account)", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(json({ error: { message: "The caller does not have permission" } }, 403));
    await expect(
      createSheetsApi({ getAccessToken: async () => "t", fetch }).appendRow("id", "October 13, 2026", ["a"]),
    ).rejects.toThrow("The caller does not have permission");
  });
});

describe("attendance log names", () => {
  it("prefers the name and falls back to the email", async () => {
    const { displayName } = await import("@/features/admin-log/service");
    expect(displayName({ name: "Jane Doe", email: "jane@firstmate.tech" })).toBe("Jane Doe");
    expect(displayName({ name: "  ", email: "jane@firstmate.tech" })).toBe("jane@firstmate.tech");
  });
});
