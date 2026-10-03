# Reference review — 3 October 2026

Both supplied PDFs were read in the signed-in Chrome Google Drive viewer. The Drive connector
required reauthentication; browser access succeeded. This file is a summary, not a copy of the PDFs.

## Matrix side challenge

Source: https://drive.google.com/file/d/1J7qway9ehQEYEBD3zckZSIuktHTvQxY3/view
Title: tech-europe-matrix-os.pdf (1 page).
Build an ambitious working system using Matrix as the persistent computer for agents, files,
apps and tools. Show ambition, collaboration of tools/context, and a usable result.
The brief lists participant code TechEuropeMatrix for one month, and a winning-team award
of three months plus $300 AI credits per member. Verify eligibility/redemption with the organizers.

## Google DeepMind × Tech:Europe Stockholm builder guide

Source: https://drive.google.com/file/d/1ej_VCw5TropAzOmFvWghRf9G9id2j4uB/view
Title: Build voice-first: Stockholm hackathon challenge brief and builder guide (7 pages).
The challenge requires voice-first interaction, a concrete person's problem and a new capability.
Demonstrate live and interview a user. Combine at least two recent capabilities where useful.
The listed model IDs include gemini-3.8-live and gemini-3.8-flash. Slow work belongs behind
function calls. Keep API keys out of browsers; use ephemeral tokens or a backend relay.
A headset/push-to-talk and HTTPS or localhost matter for the venue demo.

## Verified official references

- https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live
- https://ai.google.dev/gemini-api/docs/live-api
- https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens
- https://ai.google.dev/gemini-api/docs/interactions-overview
- https://github.com/google-gemini/gemini-skills
- https://matrix-os.com/skills.md
- https://matrix-os.com/docs/cli

## FinAstra comparison

Inspected the local FinAstra shared/canvas.ts and src/useRealtime.ts.
Its canvas reducer preserves context and its voice flow has explicit cleanup/interruption handling.
It uses OpenAI WebRTC and domain-specific sample financial data, so its provider transport and
fixed schema should not be copied into Gemini's broader analytics implementation.

## Assigned event account

Read the organizer instructions at http://goo.gle/hackathon-account, which redirects to
https://docs.google.com/document/d/1yaZoI6mscyw7QB3vEBOmzWLyTqt2O6AH7cj6BzF4M0g/view.
The temporary event account/project is intended for high-quota hackathon use and is scheduled
for deletion soon after the event. Save source and assets outside it. Import the assigned project
in AI Studio if missing, then use its API key privately. Do not commit keys.
Account identity and password are deliberately omitted from these project files.
