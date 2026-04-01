// lib/tools/amazon.ts
// Amazon tools — read-only (price check, details) and write (wishlist add = CIBA required)
// Note: Amazon has no public API; this uses a lightweight scrape via the backend.
// For production, use the Amazon PA API (Product Advertising API) with Token Vault.

import { tool } from "@langchain/core/tools";
import { z } from "zod";

// ─── Get product details from page context ────────────────────────────────────
// (Already extracted by the content script — just formats it for the agent)
export const getProductDetailsTool = tool(
  async ({ asin, title, price, rating }) => {
    if (!asin) return "No product found on this page.";
    return [
      `Product: ${title}`,
      `ASIN: ${asin}`,
      price ? `Price: ${price}` : "Price: not available",
      rating ? `Rating: ${rating}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  },
  {
    name: "get_product_details",
    description: "Get details of the Amazon product currently being viewed",
    schema: z.object({
      asin: z.string().optional(),
      title: z.string().optional(),
      price: z.string().optional(),
      rating: z.string().optional(),
    }),
  }
);

// ─── Add to wishlist (CIBA required) ─────────────────────────────────────────
export const addToWishlistTool = tool(
  async ({ asin, title }) => {
    // In a real implementation: call Amazon PA API with a Token Vault token
    // For demo: simulate the action
    return `✅ "${title}" (ASIN: ${asin}) added to your wishlist.`;
  },
  {
    name: "add_to_wishlist",
    description:
      "Add the current Amazon product to the user's wishlist. REQUIRES CIBA approval.",
    schema: z.object({
      asin: z.string().describe("Amazon ASIN"),
      title: z.string().describe("Product title"),
    }),
  }
);

// ─── Price comparison hint ────────────────────────────────────────────────────
export const checkPriceTool = tool(
  async ({ title, price }) => {
    // Placeholder — in production, call a price comparison API
    return `Current price for "${title}": ${price ?? "unknown"}.\nTip: Check CamelCamelCamel for price history.`;
  },
  {
    name: "check_price",
    description: "Check the current price of the product and suggest price comparison resources",
    schema: z.object({
      title: z.string(),
      price: z.string().optional(),
    }),
  }
);

export const amazonTools = [getProductDetailsTool, checkPriceTool, addToWishlistTool];
export const WRITE_TOOLS = new Set(["add_to_wishlist"]);
