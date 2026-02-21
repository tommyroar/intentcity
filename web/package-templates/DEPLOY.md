# Deploying the Web Package

This package contains a pre-built, self-contained SPA with all campsite data embedded. No backend or secrets required.

## Steps

1. **Create a new public GitHub repository** (the repo name becomes part of the Pages URL: `https://<user>.github.io/<repo>/`)

2. **Commit package contents to `main`:**
   ```
   dist/
   .github/workflows/deploy-pages.yml
   DEPLOY.md
   ```

3. **Enable GitHub Pages:**
   - Go to repo Settings > Pages
   - Set Source to **GitHub Actions**

4. **Deploy:**
   - Push to `main` triggers auto-deploy, or run the workflow manually from the Actions tab

5. **Site is live at:** `https://<user>.github.io/<repo>/`

## Notes

- No secrets needed — the Mapbox token is compiled into the JS bundle at build time
- To update the map data or app: generate a new package from the source repo, replace `dist/`, push to `main`
