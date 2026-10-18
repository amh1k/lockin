---
title: "LockIn: focus that understands the page"
published: false
tags: devchallenge, hf26challenge
---

*This is a submission for the [Hacktoberfest Open-Source AI Challenge Week 2: Side Hustle](https://dev.to/challenges/hacktoberfest-week2-2026-10-12).*

**Status: draft, not ready to publish.** Replace pending items with evidence from the actual demo machine. Do not publish a claim that cannot be demonstrated. The official submission window ends October 18, 2026 at 11:59 PM PDT; confirm enough time remains before submitting.

## What I Built

People often need the same website for both focused work and distraction. A domain blocklist treats them identically. LockIn is a Chrome extension that uses a person's current goal and bounded page context to decide whether the current page appears relevant. It keeps supported research available, places unrelated pages behind an accessible focus dialog, and gives the user an exact-page override or a way to end the session.

LockIn is the product being built for the Side Hustle challenge. The product hypothesis is that students, developers, and independent professionals may pay to keep useful research available while limiting distractions. That demand and willingness to pay remain unvalidated until tester feedback is recorded.

## Demo

**Pending recording.** The demo should show a real session, actual Gemma decisions on two pages from the same supported site, visible inference time, exact-page override, and session end. Do not stage or edit a decision to imply it came from a live model.

## Code

Source: [github.com/amh1k/lockin](https://github.com/amh1k/lockin). Installation and local model setup are in the [README](../README.md).

## How I Built It

The extension uses Chrome Manifest V3. A content script extracts a small, bounded snapshot from the visible top-level page. The service worker sends the goal and snapshot to Gemma 3 1B through the user's local Ollama installation. A validated result allows, blocks, or leaves the page available with an uncertainty/unavailable status. Session state and exact-page overrides stay in extension session storage; page snapshots are not stored. The browser runtime does not send browsing text to cloud telemetry.

The MVP supports `www.youtube.com` and `www.reddit.com`. It does not read video/audio or embedded frames. The overlay is a cooperative focus aid, not a network blocker or tamper-proof security boundary.

The model is open-weight and governed by [Gemma's terms](https://ai.google.dev/gemma/terms); it is not MIT- or Apache-licensed. LockIn's extension code is MIT-licensed.

## Why Does Open Innovation Matter?

Running an open-weight model locally makes page relevance decisions possible without sending a person's goal or browsing snapshot to a hosted inference API. It also gives the user a predictable local inference path instead of a per-request cloud bill. The tradeoff is setup friction and hardware-dependent speed; this draft will include real setup and latency results after the live run.

## Prize Categories

Intended entry: **Best Use of Gemma**. Gemma is the core technology making the goal-to-page relevance decision. Include the live-demo evidence and measured fixture report before claiming the entry in the published post. No Sentry Agent Tracing or ElevenLabs category is claimed; those integrations were not built.

## Results and evidence to add before publishing

- Held-out accuracy: **Pending live evaluation**; see [`eval/results.md`](../eval/results.md).
- False blocks among relevant fixtures: **Pending**.
- Distracting pages correctly blocked: **Pending**.
- Warm p95 latency, model digest, and test machine: **Pending**.
- User feedback / willingness to pay: **Not collected**. See the [tester record](demo/feedback.md); add a “My First User” section only if a real test occurs.
- Browser lifecycle checks: **Pending**; see the [manual checklist](testing/manual-checklist.md).

Team DEV handles: **Pending confirmation**. If this is a team submission, name one publisher and credit all teammates here as the challenge rules require.
