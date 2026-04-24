# Licensing

**Meridian is source-available under the Functional Source License (FSL-1.1-ALv2).**

This is not a typical permissive open-source license like MIT or Apache. Read
this document before you build on top of Meridian in a commercial setting.

## Plain English

You can:

- Read, fork, and modify the code freely.
- Use Meridian inside your own product, company, or research.
- Self-host Meridian for your own use, your team's use, or for a client you
  consult for.
- Use it for non-commercial education and research.
- Contribute changes back via pull request.

You cannot:

- Offer Meridian (or something substantially similar) to third parties as a
  commercial product or service. In particular, you cannot run a hosted
  orchestrator service built on Meridian's code and sell it to other people.
  That is reserved for the Licensor (Meridian Labs).
- Use Meridian's name, logo, or trademarks except to truthfully identify the
  origin of the code.

## Automatic conversion to Apache-2.0

Every version of Meridian we publish becomes available under the **Apache
License, Version 2.0** two years after its original publication date. If you
are willing to wait two years for a given version, you can eventually use it
under a permissive OSS license with no Competing-Use restriction.

## Commercial license

If you want to offer Meridian (or something substantially similar) to third
parties as a product or service before the two-year Apache conversion — for
example, as a hosted SaaS competing with Meridian Labs — you need a
separate commercial license from Meridian Labs. Contact us.

## Contributor License Agreement (CLA)

All contributions are made under the project CLA (see `CONTRIBUTING.md`).
By opening a pull request you grant Meridian Labs the right to use, modify,
and relicense your contribution under the current project license and any
future license the project adopts. This exists so the project can evolve
its licensing strategy without having to re-negotiate with every past
contributor.

## Trademarks

"Meridian", "Meridian Labs", and the Meridian logo are trademarks of
Meridian Labs. The license grants you no rights to use these marks except
to truthfully identify the origin of the code. Forks of Meridian must be
renamed.

## Future `cloud/` directory

A future `cloud/` directory in this repo (or a separate private repo) will
contain proprietary managed-service code — billing, multi-tenant admin,
SSO, SCIM, audit export, managed-key proxy. That code is **not** covered
by this license and is closed-source. The FSL only covers what is published
in this repository.

## Why this license

Meridian Labs plans to offer Meridian as a commercial product and service.
A permissive license like MIT or Apache would allow a well-funded
competitor (for example, a cloud provider) to offer a hosted Meridian
service in direct competition with us on day one, using our own code. The
FSL prevents that while still letting the community freely self-host,
modify, and contribute. After two years, each version becomes Apache-2.0
automatically.

## Full text

The canonical license text is in [`LICENSE`](./LICENSE). The Functional
Source License is published at <https://fsl.software/> by Sentry, Inc.

## Questions

Licensing questions → open a GitHub discussion or email
`legal@meridian-labs.example` (replace with the real address once the
legal entity is registered).
