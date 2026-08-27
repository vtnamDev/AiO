/** @type {import('next').NextConfig} */
// KHÔNG đặt secret vào env tại đây — mọi secret đọc qua @/lib/config/env server-side.
const nextConfig = {
  reactStrictMode: true,
};

module.exports = nextConfig;
