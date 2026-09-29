import { FlatCompat } from "@eslint/eslintrc";

// eslint-config-next is resolved by name through these extends, so it is a
// real dependency even though nothing imports it.
const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  { ignores: [".next/**", "next-env.d.ts"] },
];

export default eslintConfig;
