# Local delivery package

These tools write private reports only. `.vercelignore` excludes this directory,
the two HTML reports, the video and `sources/`. No source skill or global Claude
configuration is modified.

`node tools/report/build-reports.mjs` regenerates both report HTMLs, projectstatus
and the six-scene narration spec from the measured checkpoint. Edit the checkpoint
only with fresh evidence. The initial voice and production states are pending.

`python tools/report/package-personal.py` performs a free character/budget check.
Paid rendering additionally requires an ignored/internally excluded
`sources/reports/render-authorization.json` written by the root orchestrator:

```json
{"approvedBy":"root","ready":true,"ceilingUSD":0.55}
```

Only after voice and deployment readiness are confirmed, inject the personal
`ELEVENLABS_API_KEY` into the process and add `--execute-paid`. The wrapper imports
the installed Codex `take-controlish/scripts/package.py`, uses the verified personal
Luna maria voice and Flash model, measures audio and reuses the existing tech
music/Remotion composition. Its exclusive reservation prevents automatic paid
reruns. Audio is retained if rendering fails. It never searches credential files.

After the final product commit and before final tests, capture release identity:

```powershell
node tools/report/record-evidence.mjs --snapshot --url https://immutable-deployment.vercel.app --deployment-id dpl_actualId
```

Preserve actual command output, then record its result. `--passed` merely records
the root's assessment; the delivery verifier checks markers, hashes and assertions.

```powershell
node tools/report/record-evidence.mjs --id A1 --command "node --test tests/rules.test.mjs" --output sources/reports/A1.txt --exit 0 --passed
```

For A6-A10 additionally supply the same `--url` and `--deployment-id`. Their
`assertions` objects in `sources/reports/delivery-evidence.json` must cover all
contract requirements, not just one passing subset. A9 also requires a root/user
observation of genuine human microphone use. Synthetic loopback cannot close it.
Each record binds final commit and source hash; product changes invalidate it.

The root records hashes for planHtml, contractHtml and video, then independently
observes their visible opening and supplies paths to that observation. Run
`node scripts/verify-delivery.mjs`; missing/failed/pending gates exit nonzero and
write `sources/reports/delivery-validation.json` without printing DELIVERY_OK.
