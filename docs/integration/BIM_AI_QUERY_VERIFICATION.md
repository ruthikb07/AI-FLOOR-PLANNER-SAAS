# BIM query verification

The BIM inspector answers recognized active-floor door, window, wall, room, flat and stair lookups and total window area from the canonical schedule. Responses are deterministic and contain no provider claim. Unsupported phrasing returns the supported query examples. The reference model and its property text stay outside the provider boundary.

The existing Gemini orchestration remains in the architectural generation and CAD intent paths. On the authorized live Phase 4A.1 regression, Gemini answered through `gemini-flash-lite-latest`. The initial request reported four attempts and 417 provider-reported tokens. Repeating the same brief returned `CACHED_PROVIDER_RESPONSE` with zero current calls and zero current tokens while preserving the proposal's usage. Six provider and three backend targeted regressions also passed with deterministic test doubles.

Provider classification and explanations inside BIM Studio, revision comparison, clash-resolution suggestions and controlled BIM edits remain pending. The existing CAD edit gates still protect canonical writes.
