import baseConfig from '@subbiah/reusable/tailwind.config';

/** @type {import('tailwindcss').Config} */
export default {
  ...baseConfig,
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
    './node_modules/@subbiah/reusable/src/**/*.{js,ts,jsx,tsx}',
  ],
};
