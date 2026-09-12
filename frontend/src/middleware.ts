/**
 * Per-request Content-Security-Policy with a nonce.
 *
 * The App Router injects its own inline <script> tags (the RSC streaming
 * payload, hydration bootstrap) that a static `script-src 'self'` would
 * block outright. Next.js's documented fix is a per-request nonce: generate
 * one here, put it on BOTH the outgoing request headers (so Next's renderer
 * can read it while producing the page) and the response headers (so the
 * browser enforces it), and Next automatically tags its own injected scripts
 * with it. `strict-dynamic` lets those nonce'd scripts load the rest of the
 * framework's own chunks without listing every hashed filename.
 *
 * nginx (in front of this app) deliberately does NOT set its own CSP for
 * these routes — a second, nonce-less policy from nginx would be enforced
 * ALONGSIDE this one (CSP headers combine as an intersection) and would
 * block every nonce'd script here. This file is the single source of truth
 * for the frontend's CSP; nginx only sets it for the separate API routes.
 */
import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');

  const csp = `
    default-src 'self';
    script-src 'self' 'nonce-${nonce}' 'strict-dynamic';
    style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
    img-src 'self' data: blob: https://images.unsplash.com;
    font-src 'self' https://fonts.gstatic.com data:;
    connect-src 'self';
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    frame-ancestors 'none';
    upgrade-insecure-requests;
  `.replace(/\s{2,}/g, ' ').trim();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    // Skip static assets and image-optimizer output — no HTML is rendered
    // for these, so there's nothing for a CSP header to protect there.
    '/((?!_next/static|_next/image|favicon.svg).*)',
  ],
};
