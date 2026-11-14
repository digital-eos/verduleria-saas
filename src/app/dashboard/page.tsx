import { redirect } from "next/navigation";

// Los reportes ahora viven dentro de Ventas.
export default function DashboardRedirect() {
  redirect("/ventas?vista=reporte");
}
