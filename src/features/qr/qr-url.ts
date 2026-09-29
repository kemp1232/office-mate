/** The one static QR target: the Attendance page, tagged so events record source = QR. */
export function attendanceQrUrl(appOrigin: string): string {
  const url = new URL("/attendance", appOrigin);
  url.searchParams.set("source", "qr");
  return url.toString();
}
