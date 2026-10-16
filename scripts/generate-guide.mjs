// Reuse the isolated real-kernel test environment; never access a user's workspace.
process.env.SYIC_GENERATE_GUIDE = "1";
process.env.SYIC_GUIDE_ONLY = "1";
await import("./integration.mjs");
