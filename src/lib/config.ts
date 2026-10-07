export const site = {
  name: process.env.NEXT_PUBLIC_SITE_NAME || "ReferMarket",
  url: process.env.APP_URL || "http://localhost:3000",
  description: "Find people willing to share their referral reward with you."
};
export const isDemoMode = () => process.env.PAYMENT_MODE === "demo";
