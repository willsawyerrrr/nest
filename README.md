# Personal Budget Application

A household budgeting app for two people to track incomes, model Australian tax
liability, plan spending, and track savings goals.

## Goals

- **Income tracking** — record each person's income (salary, other) with gross,
  PAYG withheld, and super.
- **Tax** — estimate full AU income tax liability per person per financial year
  (marginal brackets, Medicare levy + surcharge, HECS/HELP, offsets) and compare
  against tax already withheld.
- **Spending plans** — budget by category and period; track actuals against plan.
- **Savings goals** — set targets with dates and track progress.

## Scope decisions

- **Platform:** iOS + web, sharing one backend.
- **Data:** cloud-hosted, managed. Shared by both household members.
- **Transaction sources:** [Up Bank API](https://developer.up.com.au/) feeds +
  manual entry. Import layer designed to accept other sources later.
- **Tax:** full AU income tax modelling, versioned per financial year.
- **Tech stack:** deferred. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system shape and integrations.
- [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) — entities and relationships.
- [`docs/TAX.md`](docs/TAX.md) — AU tax modelling design.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — phased delivery plan.

## Status

Planning. Framework not yet chosen; data model and tax design being defined first.
