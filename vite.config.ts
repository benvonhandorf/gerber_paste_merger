import { defineConfig } from 'vite';

// On GitHub Actions, GITHUB_REPOSITORY is "owner/repo" and the project is
// served from https://owner.github.io/repo/, so assets need that prefix.
// Locally (and for `vite preview`), serve from the root as usual.
const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1];
const base = process.env.GITHUB_ACTIONS && repoName ? `/${repoName}/` : '/';

export default defineConfig({
  base,
});
