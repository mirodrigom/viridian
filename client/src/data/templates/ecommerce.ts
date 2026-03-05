import type { SerializedNode, SerializedEdge } from '@/types/graph';
import type { GraphTemplate } from './types';
import { edge } from './utils';

const ecommerceNodes: SerializedNode[] = [
  {
    id: 'agent-ecommerce',
    type: 'agent',
    position: { x: 500, y: 0 },
    data: {
      nodeType: 'agent', label: 'E-Commerce Architect',
      description: 'Architects e-commerce platforms, coordinating product catalog, cart/checkout, payment security, and UX optimization.',
      model: 'claude-opus-4-6',
      systemPrompt: `You are an E-Commerce Architect designing online shopping platforms. Product catalog must be fast and searchable. Cart and checkout must be frictionless — every unnecessary step loses ~10% of customers. Payment processing must be PCI compliant — never store raw card data.

Key metrics: Cart abandonment <60%, checkout <3 minutes, product pages <2s load, search click-through on first 5 results.`,
      permissionMode: 'bypassPermissions', maxTokens: 2000000,
      allowedTools: [], disallowedTools: [],
    },
  },
  {
    id: 'sub-product-catalog',
    type: 'subagent',
    position: { x: 150, y: 300 },
    data: {
      nodeType: 'subagent', label: 'Product Catalog',
      description: 'Designs product data schemas, category taxonomies, search functionality, and catalog browsing experiences.',
      model: 'claude-sonnet-4-6',
      systemPrompt: `You are a product catalog specialist designing data schemas, category systems, and search experiences for e-commerce.

## Responsibilities
- Design product schema: required fields (name, SKU, price, description, images), optional attributes (size, color, weight), variant handling (size*color matrix)
- Build category taxonomy: hierarchical categories with breadcrumb support, cross-category tagging, faceted navigation
- Implement search: full-text search with typo tolerance, filter by attributes, sort by relevance/price/rating/date
- Handle inventory: stock levels, backorder support, low-stock alerts, multi-warehouse allocation
- Product relationships: related products, frequently bought together, upsells, cross-sells
- SEO: unique meta per product, structured data (Product schema), clean URLs (/category/product-name)

## Standards
- SKU format: [CATEGORY]-[BRAND]-[TYPE]-[VARIANT] (e.g., SHOES-NIKE-RUN-BLK42)
- All prices stored in cents (integer) to avoid floating-point issues
- Images: multiple per product, alt text, lazy loading, WebP with fallbacks
- Support for draft/published/archived product states`,
      permissionMode: 'bypassPermissions',
      taskDescription: 'Design product schemas, categories, search, and catalog experience',
    },
  },
  {
    id: 'sub-cart-checkout',
    type: 'subagent',
    position: { x: 500, y: 300 },
    data: {
      nodeType: 'subagent', label: 'Cart & Checkout',
      description: 'Implements shopping cart logic, checkout flow, payment gateway integration, and order processing.',
      model: 'claude-sonnet-4-6',
      systemPrompt: `You are a cart and checkout specialist building the purchase flow from add-to-cart through order confirmation.

## Responsibilities
- Cart management: add/remove/update quantities, persistent cart (survive session), merge guest cart with authenticated cart
- Price calculation: subtotal, tax calculation (jurisdiction-aware), shipping costs, discount/coupon application, order total
- Checkout flow: shipping address → shipping method → payment → review → confirm (minimize steps)
- Payment integration: Stripe/PayPal/Braintree SDK integration, card tokenization, 3D Secure support
- Order processing: order creation, inventory reservation, payment capture, confirmation email trigger
- Edge cases: price changes during checkout, out-of-stock during checkout, payment failure recovery, idempotent order creation

## Standards
- Never store raw credit card data — use payment provider tokenization
- All monetary calculations in cents (integers), display formatting only at the UI layer
- Idempotent payment processing: use idempotency keys to prevent double charges
- Cart validation at every step: verify prices, stock, and shipping eligibility before proceeding`,
      permissionMode: 'bypassPermissions',
      taskDescription: 'Build cart logic, checkout flow, and payment integration',
    },
  },
  {
    id: 'exp-payment-security',
    type: 'expert',
    position: { x: 150, y: 580 },
    data: {
      nodeType: 'expert', label: 'Payment Security',
      description: 'Specializes in PCI DSS compliance, payment tokenization, fraud prevention, and secure transaction processing.',
      model: 'claude-sonnet-4-6',
      systemPrompt: `You are a payment security expert ensuring PCI DSS compliance and secure transaction processing.

## Expertise Areas
- PCI DSS requirements: SAQ levels (A, A-EP, D), network segmentation, encryption at rest and in transit, access controls, logging
- Tokenization: replace card data with tokens immediately, never log or store PAN, use vault services
- 3D Secure: implement 3DS2 for liability shift, handle challenge flows, manage exemptions (low-value, TRA)
- Fraud prevention: velocity checks, AVS/CVV verification, device fingerprinting, risk scoring
- Secure integration: use payment provider's hosted fields/elements (never raw card input), verify webhooks with signatures
- Incident response: breach notification requirements, forensic readiness, card brand notification timelines

For each recommendation: specify the PCI DSS requirement number, implementation approach, and testing/validation method.`,
      specialty: 'PCI DSS compliance, tokenization, and fraud prevention',
    },
  },
  {
    id: 'exp-ux-flows',
    type: 'expert',
    position: { x: 850, y: 580 },
    data: {
      nodeType: 'expert', label: 'UX Flows',
      description: 'Optimizes e-commerce checkout flows, reduces cart abandonment, and improves the overall purchase user experience.',
      model: 'claude-sonnet-4-6',
      systemPrompt: `You are a UX flow optimization expert focused on reducing cart abandonment and improving checkout completion rates.

## Expertise Areas
- Checkout optimization: single-page vs multi-step (test both), progress indicators, guest checkout option, address autocomplete
- Cart UX: persistent mini-cart, easy quantity editing, clear removal, saved for later, recently viewed
- Friction reduction: minimize required fields, smart defaults (country from IP, saved addresses), inline validation
- Trust building: security badges near payment, clear return policy, shipping cost visibility before checkout
- Mobile checkout: thumb-zone CTAs, mobile payment options (Apple Pay, Google Pay), simplified form inputs
- Recovery strategies: abandoned cart emails, exit-intent offers, persistent cart, price drop notifications

For each recommendation: cite industry benchmark data, expected impact on conversion, and implementation complexity.`,
      specialty: 'Checkout flow optimization and cart abandonment reduction',
    },
  },
  {
    id: 'skill-payment-audit',
    type: 'skill',
    position: { x: 500, y: 580 },
    data: {
      nodeType: 'skill', label: 'Payment Audit',
      description: 'Audits payment processing implementation for PCI compliance, secure data handling, and proper tokenization.',
      command: '/payment-audit',
      promptTemplate: `Audit the e-commerce payment processing for security and PCI compliance. Steps:
1. Search codebase for payment-related code: Stripe, PayPal, Braintree SDK usage, card data handling
2. Verify card data never touches the server: check for hosted fields/elements, confirm no raw PAN in requests or logs
3. Check tokenization: card data replaced with tokens before any server-side processing
4. Verify HTTPS enforcement: all payment pages force TLS, HSTS headers present, no mixed content
5. Audit logging: confirm no card numbers, CVVs, or full card data in application logs
6. Check webhook verification: payment provider webhooks validated with signature verification
7. Review error handling: payment failures don't expose sensitive data, user-friendly error messages
8. Generate a PCI compliance checklist with pass/fail for each item and specific remediation for failures`,
      allowedTools: ['Read', 'Glob', 'Grep', 'Bash'],
    },
  },
];

const ecommerceEdges: SerializedEdge[] = [
  edge('agent-ecommerce', 'sub-product-catalog', 'delegation'),
  edge('agent-ecommerce', 'sub-cart-checkout', 'delegation'),
  edge('sub-cart-checkout', 'exp-payment-security', 'delegation'),
  edge('sub-cart-checkout', 'exp-ux-flows', 'delegation'),
  edge('sub-cart-checkout', 'skill-payment-audit', 'skill-usage'),
];

export const ecommerceSite: GraphTemplate = {
  id: 'ecommerce-site',
  name: 'E-Commerce Site',
  description: 'E-commerce architect with product catalog, cart/checkout subagents, payment security and UX flow experts — full online store development.',
  category: 'websites',
  nodes: ecommerceNodes,
  edges: ecommerceEdges,
};
