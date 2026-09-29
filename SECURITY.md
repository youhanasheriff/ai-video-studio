# Security Policy

## Supported Versions

AI Video Studio has no tagged releases yet. Security fixes are applied to the latest code on the `main` branch only.

## Reporting a Vulnerability

Please do **not** open a public issue for security vulnerabilities.

Report privately using GitHub's private vulnerability reporting: open the repository's **Security** tab and choose **Report a vulnerability**. If that option is not available, contact the maintainer, [@youhanasheriff](https://github.com/youhanasheriff), through GitHub and ask for a private channel. Do not include exploit details in any public place.

Please include:

- A description of the issue and its impact
- Steps to reproduce, or a proof of concept
- The affected component (`apps/web`, `apps/api`, `apps/desktop`, Docker setup) and commit or version

This is a personally maintained open-source project. Reports are handled on a best-effort basis, and there is no guaranteed response time.

## Handling Secrets

The API integrates with third-party services and reads credentials such as `OPENAI_API_KEY`, `PEXELS_API_KEY`, and `PIXABAY_API_KEY` from environment variables.

- Never commit real keys or `.env` files. Use `.env.example` as a template only.
- If you believe a key has been exposed in this repository or its history, report it as described above and revoke the key with its provider.

## Scope Notes

- The `video-composer` package is a separate project at <https://github.com/youhanasheriff/video-composer>. Vulnerabilities specific to it should be reported in that repository.
- The `docker-compose.yml` file is intended for local development (it publishes Redis on port 6379, mounts source directories, and runs the API with `--reload`). It is not a hardened production configuration.
