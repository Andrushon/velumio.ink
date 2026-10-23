// Seed Stripe products + prices for Velumio subscription plans.
// Run with: pnpm --filter @workspace/scripts exec tsx src/seed-stripe-products.ts
//
// Idempotent: products are matched by metadata.plan, prices by lookup_key.
// Prices carry metadata.plan so the checkout flow can resolve them dynamically
// from the synced `stripe` schema (no hardcoded price IDs — survives the
// dev→prod price copy Replit performs on deploy).
import Stripe from "stripe";

async function getStripeSecretKey(): Promise<string> {
  const hostname = process.env["REPLIT_CONNECTORS_HOSTNAME"];
  const xReplitToken = process.env["REPL_IDENTITY"]
    ? "repl " + process.env["REPL_IDENTITY"]
    : process.env["WEB_REPL_RENEWAL"]
      ? "depl " + process.env["WEB_REPL_RENEWAL"]
      : null;
  if (!hostname || !xReplitToken) throw new Error("Missing Replit connector credentials");

  const isProduction = process.env["REPLIT_DEPLOYMENT"] === "1";
  const targetEnvironment = isProduction ? "production" : "development";

  const url = new URL(`https://${hostname}/api/v2/connection`);
  url.searchParams.set("include_secrets", "true");
  url.searchParams.set("connector_names", "stripe");
  url.searchParams.set("environment", targetEnvironment);

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json", "X-Replit-Token": xReplitToken },
  });
  const data = (await response.json()) as { items?: Array<{ settings?: { secret?: string } }> };
  const secret = data.items?.[0]?.settings?.secret;
  if (!secret) throw new Error("Stripe connection not found");
  return secret;
}

interface PlanConfig {
  plan: string;
  name: string;
  description: string;
  monthly: number; // EUR cents
  yearly: number; // EUR cents
}

const PLANS: PlanConfig[] = [
  {
    plan: "reader",
    name: "Velumio Reader",
    description: "Unlimited reading sessions, 100 HD illustrations per month, live slideshows.",
    monthly: 999,
    yearly: 7999,
  },
  {
    plan: "family",
    name: "Velumio Family",
    description: "Everything in Reader plus up to 5 animated movies per month and child profiles.",
    monthly: 1499,
    yearly: 11999,
  },
];

const CURRENCY = "eur";

// One-time illustration-credit top-up packs. Resolved by the checkout flow via
// product metadata `pack=illustrations`; `credits` is the number granted per
// purchase. No recurring price — mode=payment Checkout. Larger packs offer a
// better per-credit price to reward power users and reduce repeat checkouts.
interface CreditPackConfig {
  credits: number;
  amount: number; // EUR cents
  lookupKey: string;
}

const CREDIT_PACKS: CreditPackConfig[] = [
  { credits: 20, amount: 499, lookupKey: "illustration_pack_20" },
  { credits: 50, amount: 999, lookupKey: "illustration_pack_50" },
  { credits: 100, amount: 1799, lookupKey: "illustration_pack_100" },
];

function creditPackName(credits: number): string {
  return `Velumio Illustration Pack · ${credits} credits`;
}

function creditPackDescription(credits: number): string {
  return `One-time top-up of ${credits} illustration credits for editing your own story illustrations.`;
}

async function seedCreditPack(stripe: Stripe, cfg: CreditPackConfig): Promise<void> {
  // Each pack tier is its own product, matched on metadata pack + credits so
  // tiers never collide with one another.
  const existing = await stripe.products.search({
    query: `metadata['pack']:'illustrations' AND metadata['credits']:'${cfg.credits}'`,
  });
  const metadata = { pack: "illustrations", credits: String(cfg.credits) };
  let product: Stripe.Product;
  if (existing.data.length > 0) {
    product = existing.data[0]!;
    await stripe.products.update(product.id, {
      name: creditPackName(cfg.credits),
      description: creditPackDescription(cfg.credits),
      active: true,
      metadata,
    });
    console.log(`Product (existing): illustration pack ${cfg.credits} -> ${product.id}`);
  } else {
    product = await stripe.products.create({
      name: creditPackName(cfg.credits),
      description: creditPackDescription(cfg.credits),
      metadata,
    });
    console.log(`Product (created):  illustration pack ${cfg.credits} -> ${product.id}`);
  }

  const found = await stripe.prices.list({ lookup_keys: [cfg.lookupKey], active: true, limit: 1 });
  if (found.data.length > 0) {
    console.log(`  Price (existing): ${cfg.lookupKey} -> ${found.data[0]!.id}`);
    return;
  }
  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: cfg.amount,
    currency: CURRENCY,
    lookup_key: cfg.lookupKey,
    metadata,
  });
  console.log(`  Price (created):  ${cfg.lookupKey} -> ${price.id}`);
}

async function findOrCreateProduct(stripe: Stripe, cfg: PlanConfig): Promise<Stripe.Product> {
  const existing = await stripe.products.search({ query: `metadata['plan']:'${cfg.plan}'` });
  if (existing.data.length > 0) {
    const product = existing.data[0]!;
    await stripe.products.update(product.id, {
      name: cfg.name,
      description: cfg.description,
      active: true,
      metadata: { plan: cfg.plan },
    });
    console.log(`Product (existing): ${cfg.plan} -> ${product.id}`);
    return product;
  }
  const product = await stripe.products.create({
    name: cfg.name,
    description: cfg.description,
    metadata: { plan: cfg.plan },
  });
  console.log(`Product (created):  ${cfg.plan} -> ${product.id}`);
  return product;
}

async function ensurePrice(
  stripe: Stripe,
  product: Stripe.Product,
  plan: string,
  interval: "month" | "year",
  amount: number,
): Promise<Stripe.Price> {
  const lookupKey = `${plan}_${interval === "month" ? "monthly" : "yearly"}`;
  const found = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 });
  if (found.data.length > 0) {
    console.log(`  Price (existing): ${lookupKey} -> ${found.data[0]!.id}`);
    return found.data[0]!;
  }
  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: amount,
    currency: CURRENCY,
    recurring: { interval },
    lookup_key: lookupKey,
    metadata: { plan, interval },
  });
  console.log(`  Price (created):  ${lookupKey} -> ${price.id}`);
  return price;
}

async function main() {
  const secretKey = await getStripeSecretKey();
  // Match the application's pinned API rather than the SDK's newer default.
  const stripe = new Stripe(secretKey, { apiVersion: "2026-04-22.dahlia" as Stripe.LatestApiVersion });

  for (const cfg of PLANS) {
    const product = await findOrCreateProduct(stripe, cfg);
    await ensurePrice(stripe, product, cfg.plan, "month", cfg.monthly);
    await ensurePrice(stripe, product, cfg.plan, "year", cfg.yearly);
  }

  for (const cfg of CREDIT_PACKS) {
    await seedCreditPack(stripe, cfg);
  }

  console.log("\nDone. Restart the API server to run syncBackfill, or wait for webhooks to sync.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
