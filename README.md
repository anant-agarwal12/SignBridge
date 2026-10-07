# SignBridge

Text-to-sign (ISL/ASL) avatar project. Phase 0: scaffolding only.

    cp .env.example .env
    docker compose up --build

- API: http://localhost:8000/health
- Web: http://localhost:5173

Backend tests: `cd backend && pip install -e ".[dev]" && pytest`
