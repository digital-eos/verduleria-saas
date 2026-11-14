/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    // Balanza y Auditoría pasaron a Configuración; Productos pasó a llamarse Stock
    return [
      { source: "/balanza", destination: "/configuracion/balanza", permanent: true },
      { source: "/auditoria", destination: "/configuracion/auditoria", permanent: true },
      { source: "/productos", destination: "/stock", permanent: true },
    ];
  },
};

export default nextConfig;
