/** @type {import('next').NextConfig} */
const config = {
  transpilePackages: ['@grvt-grid-bot/shared'],
  output: process.env.NODE_ENV === 'production' ? 'standalone' : undefined,
};

export default config;
