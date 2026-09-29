import { redirect } from "next/navigation";
import { getViewer } from "@/features/auth/dal";

export default async function Home() {
  const viewer = await getViewer();
  redirect(!viewer ? "/login" : viewer.role === "admin" ? "/admin/attendance" : "/attendance");
}
