# dsh-final-response-presentation

English | [中文](README.zh.md)

An optional host-plane boundary that projects one completed canonical assistant response into display-only text. The service is neutral until an exact live Agent is activated, and it owns no Session-event vocabulary, serializer, model-history input, tool surface, or persistence path.

## Contract

`present(agent, events)` accepts a completed event slice, finds the final plain-text assistant message followed by a completed `turn/end`, and gives a detached frozen candidate to the selected transformer. The candidate contains only session/turn/message identity, canonical text, terminal reason, and the captured epoch. It carries no Agent, Session, tool registry, inbox, Context, or persistence handle.

The transformer's only accepted result is non-empty, size-bounded text. Exceptions, timeout, malformed output, ineligibility, cancellation, and stale epochs all return a neutral decision. Neutral means the transport delivers the canonical response unchanged; the service never regenerates a response or retries a tool.

`activate(agent, selection)` stores `OFF | ACTIVE(transformer, config, epoch)` in a process-local `WeakMap`. Switch and disable advance the epoch, abort older work, and clear cached display annotations. The Agent context owns cleanup, so disposal removes state without a durable record.

## Transport integration

The base bundle mounts one neutral service row. API Proxy keeps the disabled path synchronous. For an active Agent it buffers candidate assistant chunks until terminal completion, asks this service for a decision, and emits optional `presentation` annotations beside unchanged canonical events. The Web conversation assembler suppresses annotated source chunks and renders the annotated final text. History may reconstruct the current process-local annotation while the Agent is live; it is not present after restart.

Headless flushes canonical persistence first, then selects presented text for stdout when available. Its Session and later model history still contain the canonical assistant message.

## Security boundary

A transformer is trusted same-process application code, not a sandbox. The narrow candidate removes ambient runtime capabilities from its explicit interface, while output validation, deadlines, abort, and epoch checks bound common failure paths. Application policy decides eligibility and must fail-closed for artifacts or semantics it cannot safely present.

DSH mechanically guarantees ordering, canonical-log non-mutation, output-type restriction, no tool/control result, ephemeral isolation, and neutral fallback. It cannot prove that an arbitrary natural-language rewrite preserves meaning. Applications need their own semantic envelope, guard, and adversarial eval for that claim.

## Model Experience

### Display-only projection

#### What the model sees

Nothing from this package. Presentation runs after the model and tools have completed; `deriveMessages()` returns the same prompt history and canonical assistant messages whether presentation is off or active.

#### Token effect

Zero model-input or model-output tokens. The transform callback is application code, not a second model request.

#### KV Cache effect

None. Presentation is downstream of every model request and does not alter a cache key or model-visible prefix.

## Known Limitations and Deferred Work

- **Active presentation is completion-buffered.** Raw token streaming is withheld for the candidate response; transformed streaming is not a V1 feature.
- **V1 presents plain text only.** Mixed content, tool-call messages, tool results, and incomplete/aborted turns bypass.
- **Annotations are live-process state.** Resume and restart begin neutral or from fresh application composition; old display text is not reconstructed.
- **Classification is application-owned.** The generic service does not infer report, code, schema, or product-specific artifact semantics.
