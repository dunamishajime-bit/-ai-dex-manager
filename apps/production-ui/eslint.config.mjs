import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default [
    ...nextVitals,
    ...nextTypescript,
    {
        ignores: [
            ".next/**",
            "backups/**",
            "deploy/**",
            "node_modules/**",
            "reports/**",
            "restoretmp/**",
            "test-results/**",
        ],
    },
    {
        rules: {
            "@next/next/no-html-link-for-pages": "off",
            "@next/next/no-img-element": "off",
            "@typescript-eslint/no-empty-object-type": "off",
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/no-require-imports": "off",
            "@typescript-eslint/no-unused-vars": "off",
            "import/no-anonymous-default-export": "off",
            "prefer-const": "off",
            "react-hooks/exhaustive-deps": "off",
            "react-hooks/immutability": "off",
            "react-hooks/preserve-manual-memoization": "off",
            "react-hooks/purity": "off",
            "react-hooks/refs": "off",
            "react-hooks/set-state-in-effect": "off",
        },
    },
];
