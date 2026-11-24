/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  experimental: {
    // Keep these as plain Node requires on the server (not bundled by webpack).
    serverComponentsExternalPackages: ['pg', 'nodemailer'],
  },
};
module.exports = nextConfig;
