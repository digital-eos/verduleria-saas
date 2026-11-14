import { redirect } from "next/navigation";

/** El módulo "Precios" quedó integrado en la Caja (consultar y cambiar precios). */
export default function PreciosPage() {
  redirect("/caja");
}
