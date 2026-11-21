import { googleConfigured } from "@/lib/google";
import LoginClient from "./LoginClient";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return <LoginClient googleEnabled={googleConfigured()} />;
}
