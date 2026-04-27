# Licensing

**ALDO AI is source-available under the Functional Source License (FSL-1.1-ALv2).**

This is not a typical permissive open-source license like MIT or Apache. Read
this document before you build on top of ALDO AI in a commercial setting.

## Plain English

You can:

- Read, fork, and modify the code freely.
- Use ALDO AI inside your own product, company, or research.
- Self-host ALDO AI for your own use, your team's use, or for a client you
  consult for.
- Use it for non-commercial education and research.
- Contribute changes back via pull request.

You cannot:

- Offer ALDO AI (or something substantially similar) to third parties as a
  commercial product or service. In particular, you cannot run a hosted
  orchestrator service built on ALDO AI's code and sell it to other people.
  That is reserved for the Licensor (ALDO TECH LABS).
- Use ALDO AI's name, logo, or trademarks except to truthfully identify the
  origin of the code.

## Automatic conversion to Apache-2.0

Every version of ALDO AI we publish becomes available under the **Apache
License, Version 2.0** two years after its original publication date. If you
are willing to wait two years for a given version, you can eventually use it
under a permissive OSS license with no Competing-Use restriction.

## Commercial license

If you want to offer ALDO AI (or something substantially similar) to third
parties as a product or service before the two-year Apache conversion — for
example, as a hosted SaaS competing with ALDO TECH LABS — you need a
separate commercial license from ALDO TECH LABS. Contact us.

## Contributor License Agreement (CLA)

All contributions are made under the project CLA (see `CONTRIBUTING.md`).
By opening a pull request you grant ALDO TECH LABS the right to use, modify,
and relicense your contribution under the current project license and any
future license the project adopts. This exists so the project can evolve
its licensing strategy without having to re-negotiate with every past
contributor.

## Trademarks

"ALDO AI", "ALDO TECH LABS", and the ALDO AI logo are trademarks of
ALDO TECH LABS. The license grants you no rights to use these marks except
to truthfully identify the origin of the code. Forks of ALDO AI must be
renamed.

## Future `cloud/` directory

A future `cloud/` directory in this repo (or a separate private repo) will
contain proprietary managed-service code — billing, multi-tenant admin,
SSO, SCIM, audit export, managed-key proxy. That code is **not** covered
by this license and is closed-source. The FSL only covers what is published
in this repository.

## Why this license

ALDO TECH LABS plans to offer ALDO AI as a commercial product and service.
A permissive license like MIT or Apache would allow a well-funded
competitor (for example, a cloud provider) to offer a hosted ALDO AI
service in direct competition with us on day one, using our own code. The
FSL prevents that while still letting the community freely self-host,
modify, and contribute. After two years, each version becomes Apache-2.0
automatically.

## Full text

The canonical license text is in [`LICENSE`](./LICENSE). The Functional
Source License is published at <https://fsl.software/> by Sentry, Inc.

## Questions

Licensing questions → open a GitHub discussion or email
`legal@aldo-tech-labs.example` (replace with the real address once the
legal entity is registered).
