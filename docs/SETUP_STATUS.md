# Verified setup — 3 October 2026

- Private repository: https://github.com/RiyadMehdi7/Agens.
- `tariel-aliev` has confirmed write access to the repository.
- Matrix primary computer provisioned; hosted CLI identity, gateway and shell backend verified.
- Matrix checkout: `/home/matrix/home/projects/agens`, clean `main`, initial commit `f544405`.
- Remote GitHub authentication confirmed as `RiyadMehdi7`.
- Remote Codex 0.156.1 authenticated with ChatGPT and completed a read-only repository task.
- Remote bootstrap completed: dependencies, TypeScript check, six passing tests and build.
- Event Gemini key configured privately with permissions 0600, outside the repository.
  The checkout's ignored `.env.local` points to that private environment file.
- Remote model metadata verified for `gemini-3.8-live` and `gemini-3.8-flash`.

## Persistent development terminal

Matrix terminal `bright-vale`, tab `tt_5422089b98c55eac08050b50847a7277`.

```sh
matrix shell connect --profile cloud --project main --tab tt_5422089b98c55eac08050b50847a7277
```

Interactive launch command:

```sh
codex --cd /home/matrix/home/projects/agens --ask-for-approval never --sandbox workspace-write
```

Use [CODEX_START.md](CODEX_START.md) for the implementation brief.
Temporary setup/probe terminal tabs were terminated after their results were captured.

## Evidence still required

The repository is a development foundation. Frontend rendering, live audio, Excel/database/API
connectors and a working dashboard demo have not been implemented or verified by this setup.
Model metadata access does not demonstrate generated responses or a live audio session.

The event account is temporary. Keep source and deliverables in GitHub/Matrix and replace the
event provider credentials when moving beyond the hackathon.
