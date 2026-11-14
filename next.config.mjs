/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    // La pantalla de la balanza pasó a Configuración
    return [{ source: "/balanza", destination: "/configuracion/balanza", permanent: true }];
  },
};

export default nextConfig;
