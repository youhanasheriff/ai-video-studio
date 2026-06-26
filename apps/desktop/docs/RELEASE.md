# Release Notes

## Build Commands

- `npm run build` compiles TypeScript and Electron/Vite output.
- `npm run pack` creates an unpacked app for local inspection.
- `npm run dist` runs `electron-builder` with `electron-builder.yml`.

## Signing And Updates

Auto-update code is present but disabled unless `AIVS_ENABLE_AUTO_UPDATE=1`.
Real distribution still needs external release infrastructure:

- macOS updates require Developer ID signing and notarization.
- Windows installers should be Authenticode signed before public release.
- `electron-builder.yml` uses a placeholder generic publish URL. Replace it with the real release feed before enabling updates.

## Runtime Dependencies

The app prefers bundled `ffmpeg-static`/`ffprobe-static` binaries and falls back to `PATH`.
SQLite still uses the `sqlite3` CLI, so packaged builds should keep the dependency-check UI visible until a future `better-sqlite3` migration.

Optional local story providers remain user-installed:

- FLUX.2/mflux: `uv tool install --upgrade mflux --with hf_transfer`
- CosyVoice: configure a local checkout path and conda environment in the provider settings.
