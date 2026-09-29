import { redirect } from "next/navigation";
import { getViewer } from "@/features/auth/dal";

export default async function Home() {
  redirect((await getViewer()) ? "/attendance" : "/login");
}
