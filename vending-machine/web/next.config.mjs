/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  output: 'standalone',
  serverExternalPackages: ['@libsql/client'],
  env: { API_BASE_URL: process.env.API_BASE_URL ?? 'http://localhost:4000' },
};
