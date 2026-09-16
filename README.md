# Motrix Documentation

Documentation site for [Motrix Edge](https://github.com/Motrix-Energy/motrix-edge)
and [Motrix Edge View](https://github.com/Motrix-Energy/motrix-edge-view),
published at https://motrix-energy.github.io — Astro + Starlight, themed with
the Motrix "Modernist" design system.

## Develop

Requires Node 22 (`.nvmrc`). Astro is pinned to v5 with Starlight 0.36 because
Astro 6+ refuses Node below 22.12 — once local Node is upgraded past that, both
can be bumped to latest.

```sh
npm install
npm run dev        # http://localhost:4321 — search only works on built output
npm run build      # builds dist/ and runs Pagefind indexing
npm run preview    # serve dist/ — use this to test search
```

## Deploy

Pushing to `main` builds and deploys the site via
`.github/workflows/deploy.yml`. One-time setup: repository Settings → Pages →
Source: "GitHub Actions".

## License

Apache-2.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE). The vendored Archivo
typeface is licensed OFL-1.1 (`src/fonts/OFL.txt`).
