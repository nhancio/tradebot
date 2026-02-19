import "dotenv/config";

const config = {
  kite: {
    apiKey: process.env.KITE_API_KEY || "",
    apiSecret: process.env.KITE_API_SECRET || "",
    accessToken: process.env.KITE_ACCESS_TOKEN || "",
    redirectUrl: process.env.KITE_REDIRECT_URL || "http://127.0.0.1:3000/callback",
  },
};

export default config;
