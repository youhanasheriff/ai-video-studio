# Contributing to AI Video Studio

Thanks for your interest in contributing. This guide covers how to set up the project, run the checks that CI runs, and submit changes.

## Repository Layout

| Path | Description |
| --- | --- |
| `apps/web` | Next.js frontend (TypeScript, Tailwind CSS, shadcn/ui). Standalone pnpm project with its own `pnpm-lock.yaml`. |
| `apps/api` | FastAPI backend with Celery workers and Redis. |
| `apps/desktop` | Local-first desktop app (Electron). Uses npm. |
| `packages/` | Shared workspace packages (`config`, `ui`). |
| `scripts/` | Helper scripts for local development. |

## Development Setup

### Docker (recommended)

Starts the web app, API, Celery worker, and Redis:

```bash
docker-compose up --build
```

- Frontend: <http://localhost:3000>
- API docs (Swagger UI): <http://localhost:8000/docs>

API keys (`OPENAI_API_KEY`, `PEXELS_API_KEY`, `PIXABAY_API_KEY`) are read from your environment. Copy `.env.example` to `.env` and fill in values; never commit `.env`.

### Web (`apps/web`)

```bash
cd apps/web
pnpm install
pnpm dev
```

### API (`apps/api`)

Mock mode needs no Redis or API keys:

```bash
cd apps/api
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
USE_IN_MEMORY_DB=1 DEV_MOCK_GENERATION=1 uvicorn main:app --reload
```

The full generation pipeline needs Redis on `localhost:6379` plus the OpenAI and stock-media API keys. See `apps/api/README.md` for all environment variables. You can also use the helper scripts in `scripts/` (for example `./scripts/dev-api.sh`).

### Desktop (`apps/desktop`)

```bash
cd apps/desktop
npm install --legacy-peer-deps
npm run dev
```

## Running the Checks

CI (`.github/workflows/ci.yml`) runs the following. Please run them locally before opening a pull request.

**Web** (from `apps/web`):

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm exec tsc --noEmit
pnpm build
```

**API** (from `apps/api`):

```bash
pip install ruff
ruff check --isolated --select E4,E7,E9,F .
```

The API does not have an automated test suite yet. Contributions that add one (for example with `pytest`) are welcome.

## Submitting Changes

1. Fork the repository and create a branch from `main`.
2. Keep changes focused; unrelated changes belong in separate pull requests.
3. Run the checks above and make sure they pass.
4. Open a pull request against `main` describing what changed and why. Include screenshots for visible UI changes.

## Reporting Bugs and Requesting Features

Open an issue with clear reproduction steps (for bugs) or a description of the use case (for features). For security problems, do not open a public issue; follow [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
