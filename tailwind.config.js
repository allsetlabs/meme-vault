import baseConfig from '@allsetlabs/forge/tailwind.config';

/** @type {import('tailwindcss').Config} */
export default {
  ...baseConfig,
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
    './node_modules/@allsetlabs/forge/src/**/*.{js,ts,jsx,tsx}',
  ],
};
