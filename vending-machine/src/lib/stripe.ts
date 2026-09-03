import Stripe from 'stripe';
import { requireEnv } from '../config.js';

let client: Stripe | null = null;

export function stripe(): Stripe {
  if (!client) client = new Stripe(requireEnv('STRIPE_SECRET_KEY'), { apiVersion: '2026-08-26.dahlia' });
  return client;
}
