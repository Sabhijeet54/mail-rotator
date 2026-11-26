/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  experimental: {
    instrumentationHook: true, // starts the background sender (instrumentation.js)
    // Keep these as plain Node requires on the server (not bundled by webpack).
    serverComponentsExternalPackages: ['pg', 'nodemailer', 'imapflow', 'mailparser'],
  },
};
module.exports = nextConfig;
