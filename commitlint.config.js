/** @type {import('@commitlint/types').UserConfig} */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Enforce lower-case commit subjects:  "feat: add user module" ✓
    //                                      "feat: Add User Module" ✗
    'subject-case': [2, 'always', 'lower-case'],

    // Allow slightly longer subjects than the 100-char default when a path or
    // identifier pushes you over — raise to 120 to avoid artificial wrapping.
    'header-max-length': [2, 'always', 120],
  },
};
