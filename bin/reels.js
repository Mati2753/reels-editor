#!/usr/bin/env node
// Exposes the TypeScript CLI as the `reels` command without a build step.
import { register } from "tsx/esm/api";

register();
await import("../src/cli/index.ts");
