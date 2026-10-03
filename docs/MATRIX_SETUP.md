# Matrix OS + Codex setup

1. Open https://app.matrix-os.com and enter your account/workspace. If provisioning or billing is
   needed, complete it yourself. Ask onsite staff how TechEuropeMatrix applies before checkout.
2. Local CLI: npm install -g @finnaai/matrix@latest.
3. Run matrix login --profile cloud and approve its browser/device flow.
4. Verify matrix doctor, matrix whoami, matrix status and matrix instance info --json.
5. In the Matrix terminal, verify gh and codex are available. Authenticate them there using their
   own browser/device logins. Never copy local credential files.
6. Clone the private repository into a project-scoped workspace with remote gh repo clone.
7. Run bash scripts/matrix-bootstrap.sh in that checkout.
8. Launch codex from the repository in a persistent Matrix terminal and use CODEX_START.md.
9. Put the Gemini key in Matrix's private environment or a private .env.local with mode 0600.
10. Run npm run verify:gemini on Matrix. Then build and test an actual Live connection.

CLI routing evolves. Check matrix run --help and the installed Matrix skills before selecting
project/session flags. Current project skill uses matrix run -it --project <project> -C <path> -- codex.
Report each returned terminal tab ID and its reattach command.

Expected evidence: authenticated Matrix identity, remote checkout/commit, successful remote checks,
Codex running there, provider model access and finally live voice/data demo. These are separate gates.

See [SETUP_STATUS.md](SETUP_STATUS.md) for the verified Matrix execution on 3 October 2026.
Preparing setup instructions alone does not verify a cloud runtime.
