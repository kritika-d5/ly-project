# Graph-aware retrieval — design, not yet built

**Status: deferred.** Written 2026-09-06 while building the citation graph UI.
Nothing in this document is implemented. Search today is purely textual
(`server/src/lib/search.ts`): the citation graph is displayed but does no work
in ranking or in answers.

This is the spec to implement from when that changes.

---

## Why this matters to the project

The project claims to be a **citation-aware** RAG system. Right now the
citations are a sidebar and a picture. Until the graph influences what gets
retrieved or what the answer says, "citation-aware" describes the visualisation,
not the retrieval — which is a weaker claim than the corpus can support, since
the data phase already paid for the edges and their polarity.

Three mechanisms below, in the order they should be built.

---

## 1. Citation expansion

**The idea.** After hybrid search returns its top cases, walk one hop along
`cites` and let strongly-matching cases vouch for the authorities they rest on.

If the best-matching passage for *"when can bail be refused for economic
offences"* sits in Sanjay Chandra, and Sanjay Chandra rests on an earlier
authority for exactly that proposition, that earlier case is relevant even
though its own wording never matched the query. Pure embedding search cannot
see this; the graph can.

**Scoring.**

```
seeds        = top ~10 cases from searchCases(), with their RRF scores
expansion[d] = Σ over edges (s -> d) of   λ · score[s] · w(polarity[s->d])

w(pos)     = 1.0
w(mixed)   = 0.6
w(neg)     = 0.3     // disagreed-with, but still on point — never zero
w(null)    = 0.7     // no citetext evidence; 26 of 336 edges
λ          = 0.35
```

λ is deliberately small: an expanded case should only outrank a directly-matched
one when **several** strong hits point at it. Tune λ against the evaluation in
§4, not by eye.

Merge `expansion` into the final case scores, then re-sort.

**Provenance is not optional.** Every graph-surfaced result must carry:

```ts
viaGraph: true,
becauseOf: [{ tid, title, polarity }]   // the seeds that pulled it in
```

so the card can say *"surfaced because Antil and Sanjay Chandra both rely on
it."* An extra result with no explanation reads as a bug, and in a legal tool
an unexplained result is worse than a missing one.

**Where it goes.** A new function in `server/src/lib/search.ts` wrapping
`searchCases`, plus an `expand=true` query flag on `GET /api/search` so the
behaviour can be compared against the current ranking without a redeploy.

**One hop only.** Two hops on a graph with a median degree of 2 and hubs at 25
pulls in most of the corpus and the scores stop meaning anything.

---

## 2. Counter-authority ("has this been doubted?")

**The idea.** For any case in the results, look up incoming edges where
`polarity ∈ {neg, mixed}` — later cases that did not simply follow it.

```js
edges.find({ dst: tid, polarity: { $in: ['neg', 'mixed'] } })
```

Two surfaces:

- **Search results and case page:** a badge — *"3 later cases did not simply
  follow this"* — linking to those cases.
- **Chat context:** inject the list into the prompt so the model can say
  "note that Sushila Aggarwal departed from this in part" instead of presenting
  a qualified holding as settled.

**Why it is the highest-value item per line of code.** This is what commercial
citators (Shepard's, KeyCite) exist to provide, and it is the clearest
expression of the citation-awareness claim. The data is already sitting in
`edges.polarity`, populated and unused.

**Coverage is thin and must be stated:** only 33 of 336 edges are `neg` or
`mixed`. Absence of a warning is *not* evidence a case is good law. The UI must
never imply "no warning = safe to rely on".

---

## 3. Authority boost — weak, and with a caveat

The obvious move is to boost cases with a high in-corpus `citedBy`:

```
finalScore = rrfScore · (1 + α · log(1 + citedByCount))
```

**Keep α small, and say why in the report.** The citation counts here are partly
an artefact of how the corpus was collected, not a measure of authority. The
data phase snowballed **backward along `cites`** from eight chosen seeds, so the
highest-degree node is Siddharam Mhetre at 25 — not Satender Kumar Antil, which
is the actual modern landmark and the corpus centrepiece. Ranking hard on
in-corpus degree would encode the sampling method as if it were legal
significance.

Use it as a tiebreaker between otherwise equally-scoring cases. Do not use it
as a primary signal, and do not present it to the user as "importance".

If a real authority measure is ever wanted, compute PageRank **once** in the
data repo (Python is already there; NetworkX is fine for that), write the score
onto `nodes`, and serve it as a stored field — the corpus is static, so there is
no reason to compute graph metrics at runtime.

---

## What NOT to do

**Do not feed expanded cases into the case-scoped chat.**
`POST /api/cases/:tid/chat` is deliberately about one judgment. Its whole
attribution model — every passage tagged with whether it is the court speaking,
quoted statute, or an SCR headnote — assumes a single source document. Mixing in
passages from other cases breaks the guarantee that "this judgment held X" is
checkable against the document on screen.

Cross-case question answering is a **separate mode** with its own prompt, its
own citation format (every claim naming its case), and its own UI. Worth
building; not worth smuggling into the case chat.

---

## 4. Evaluation — the part that makes it a result

Without this, the work is "we added graph expansion", which is not a finding.

- Assemble **10–15 queries with known correct answers** — bail propositions
  where the governing case is not in dispute (anticipatory bail duration →
  Sushila Aggarwal; default bail under 167(2) → Rakesh Kumar Paul; economic
  offences → Sanjay Chandra; UAPA delay → K.A. Najeeb).
- Measure **recall@10 and MRR** with expansion off and on, sweeping λ.
- Report the delta, and report the failures too — cases where expansion pushed
  a correct answer *down*.

"Graph expansion improved recall@10 from X to Y on our corpus" is a reportable
result. It also tells you honestly whether to keep the feature.

---

## Suggested order

1. §2 counter-authority — smallest, highest value, no ranking risk
2. §1 citation expansion behind an `expand=true` flag
3. §4 evaluation, then decide whether expansion stays on by default
4. §3 authority boost as a tiebreaker, only if §4 shows it helps
