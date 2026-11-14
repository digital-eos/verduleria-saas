/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    // Balanza y Auditoría pasaron a Configuración
    return [
      { source: "/balanza", destination: "/configuracion/balanza", permanent: true },
      { source: "/auditoria", destination: "/configuracion/auditoria", permanent: true },
    ];
  },
};

export default nextConfig;
