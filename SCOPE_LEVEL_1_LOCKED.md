# Scope Level 1 — LOCKED Product Scope

Level 1 answers **what we are building**. Later levels may refine implementation, but they must preserve this product boundary unless the scope is explicitly reopened.

## Product

An AI-first ecommerce platform for small Bulgarian merchants selling physical products. A merchant describes the business, provides a few facts and images, and receives a real online store that can display products, accept orders, support delivery and payment flows, send transactional messages, and be operated through natural language.

## Target customer

Small Bulgarian makers, sourcers, and social sellers who currently sell through Facebook, Instagram, TikTok, Messenger, Viber, or word of mouth and do not want to learn ecommerce infrastructure. The initial buyer is a non-technical merchant; the initial shopper is a Bulgarian customer using a mobile device.

## Core promise

> **Разкажи ни какво продаваш. След няколко минути имаш истински онлайн магазин.**

This means a functioning ecommerce store, not a landing page or an unfinished setup wizard.

## Amboras-like experience

The intended mental model is `intent → AI takes action → visible result`.

- A short prompt can begin store creation.
- Useful output appears quickly, before lengthy configuration.
- Brand, product drafts, storefront, and other independent work can progress in parallel.
- The merchant sees live progress and can continue the conversation during work.
- The merchant can point at a storefront element and say “change this”.
- AI changes are previewable, auditable, recoverable, and publishable only after appropriate checks.
- Conventional controls remain available when they are faster or clearer.
- The platform absorbs technical complexity such as commerce infrastructure, domains, email, and integrations.

## MVP boundary

This is the product boundary, delivered incrementally through Level 4. A capability being in the MVP boundary does not mean it belongs in M0 or the first release slice.

### In scope

- Bulgarian-first merchant onboarding and business profile.
- Physical products, variants, prices, inventory, images, collections, and product metadata.
- AI-generated suggestions and drafts, with merchant confirmation before factual products become published.
- Mobile-first storefront and mobile-capable merchant administration.
- Cart, guest checkout, delivery details, COD, order creation, merchant order management, and inventory decrement.
- Transactional email, merchant notifications, consent-aware basic analytics, legal/profile surfaces, and launch readiness.
- Econt integration as the first courier boundary.
- Card-payment provider abstraction, with COD available before card onboarding.
- Instant platform subdomain; custom domains as a supported product capability with clear DNS/SSL handling.
- AI operation of the above through safe, contextual actions.

### Out of scope for the initial boundary

Services and bookings, digital products, subscriptions, wholesale/B2B, marketplaces, multiple warehouses, international expansion, multi-country tax engines, broad payment/courier sprawl, drag-and-drop website builder behaviour, app marketplace, sophisticated CRM/accounting replacement, full email marketing, loyalty, abandoned-cart automation, advanced SEO, A/B testing, autonomous CRO, advertising management, native mobile apps, and arbitrary AI-generated website code.

## Product success

The product is successful when ordinary merchants can reach a published store, receive genuine orders, operate it without developer intervention, return to change it conversationally, and eventually pay for the service. The north-star outcome is active stores generating monthly orders.
