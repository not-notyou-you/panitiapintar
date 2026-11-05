import { validEnv } from "./env-fixture";

// Unit tests never talk to real services; give modules that validate env a complete fake set.
for (const [k, v] of Object.entries(validEnv)) process.env[k] ??= v;
