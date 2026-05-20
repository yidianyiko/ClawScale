# Channel System Owners

Ownership system: Channel System

Boundary spec:
`docs/superpowers/specs/2026-05-19-frontend-platform-channel-boundary-design.md`

Owns:

- provider config schemas
- customer channel management service contract
- provider lifecycle semantics behind backend-only Channel modules

Allowed inbound callers:

- Platform System customer/account route adapters
- provider webhook routes and outbound delivery adapters

Verification surfaces:

- `gateway-api`
